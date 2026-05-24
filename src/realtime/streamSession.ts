import type { WebSocket } from "@fastify/websocket";
import type { OplogService } from "../oplog/oplogService.js";
import type { OplogEntry } from "../oplog/oplogSchema.js";
import type { BucketChecksum } from "../oplog/bucketChecksum.js";
import {
  streamActiveConnections,
  streamFrameTotal,
  streamBackpressurePausedTotal,
} from "../observability/metrics.js";

export interface StreamStartFrame {
  type: "start";
  buckets: string[];
  checkpoints?: Record<string, number>;
  bucketStates?: Record<string, { seq: number; csum: number }>;
  priorityMax?: number;
  collections?: string[];
}

export interface StreamSessionOptions {
  socket: WebSocket;
  oplog: OplogService;
  bucketChecksum?: BucketChecksum;
  batchSize?: number;
  ackTimeoutMs?: number;
  bucketPriority: Map<string, number>;
}

const DEFAULT_BATCH = 100;
const DEFAULT_ACK_TIMEOUT_MS = 5_000;

export class StreamSession {
  readonly buckets: Set<string>;
  private readonly socket: WebSocket;
  private readonly oplog: OplogService;
  private readonly bucketChecksum?: BucketChecksum;
  private readonly batchSize: number;
  private readonly ackTimeoutMs: number;
  private readonly bucketPriority: Map<string, number>;
  private readonly checkpoints: Map<string, number>;
  private readonly collections?: string[];
  private readonly priorityMax?: number;

  private paused = false;
  private awaitingAck = false;
  private closed = false;

  constructor(opts: StreamSessionOptions, start: StreamStartFrame) {
    this.socket = opts.socket;
    this.oplog = opts.oplog;
    this.bucketChecksum = opts.bucketChecksum;
    this.batchSize = opts.batchSize ?? DEFAULT_BATCH;
    this.ackTimeoutMs = opts.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    this.bucketPriority = opts.bucketPriority;
    this.buckets = new Set(start.buckets);
    this.checkpoints = new Map();
    for (const [k, v] of Object.entries(start.checkpoints ?? {})) {
      this.checkpoints.set(k, v);
    }
    this.collections = start.collections;
    this.priorityMax = start.priorityMax;
    streamActiveConnections.inc();
  }

  setPaused(v: boolean): void {
    this.paused = v;
  }

  ack(_checkpoint?: number): void {
    this.awaitingAck = false;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    streamActiveConnections.dec();
  }

  private send(frame: Record<string, unknown>): void {
    if (this.closed) return;
    try {
      this.socket.send(JSON.stringify(frame));
      streamFrameTotal.inc({ type: String(frame.type) });
    } catch {
      this.close();
    }
  }

  private priorityFor(bucket: string): number {
    return this.bucketPriority.get(bucket) ?? 100;
  }

  private async waitForAck(): Promise<void> {
    if (!this.awaitingAck) return;
    streamBackpressurePausedTotal.inc();
    const start = Date.now();
    while (this.awaitingAck && !this.closed && Date.now() - start < this.ackTimeoutMs) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  async backfill(): Promise<void> {
    // Group buckets by priority asc.
    const byPriority = new Map<number, string[]>();
    for (const b of this.buckets) {
      const p = this.priorityFor(b);
      if (this.priorityMax !== undefined && p > this.priorityMax) continue;
      if (!byPriority.has(p)) byPriority.set(p, []);
      byPriority.get(p)!.push(b);
    }
    const priorities = [...byPriority.keys()].sort((a, b) => a - b);

    for (let i = 0; i < priorities.length; i++) {
      const p = priorities[i];
      const bucketsAtP = byPriority.get(p)!;
      let minCheckpoint = Infinity;
      for (const b of bucketsAtP) {
        minCheckpoint = Math.min(minCheckpoint, this.checkpoints.get(b) ?? 0);
      }
      if (!Number.isFinite(minCheckpoint)) minCheckpoint = 0;
      const seenSeq = new Map(this.checkpoints);

      // Page through the oplog for these buckets.
      while (!this.closed) {
        if (this.paused) await this.waitForAck();
        const entries: OplogEntry[] = await this.oplog.getEntriesAfter(
          Math.min(...bucketsAtP.map((b) => seenSeq.get(b) ?? 0)),
          bucketsAtP,
          {
            limit: this.batchSize,
            collections: this.collections,
          },
        );
        if (entries.length === 0) break;
        for (const e of entries) {
          seenSeq.set(e.bucket, e.seq);
          this.checkpoints.set(e.bucket, e.seq);
        }
        this.send({ type: "data", priority: p, entries });
        this.awaitingAck = true;
        await this.waitForAck();
      }

      for (const b of bucketsAtP) {
        const csum = await this.bucketChecksum?.get(b);
        if (csum) {
          this.send({ type: "checkpoint", bucket: b, seq: csum.seq, csum: csum.csum });
        }
      }
      this.send({
        type: "checkpoint_complete",
        priority: p,
        final: i === priorities.length - 1,
      });
    }
  }

  async deliver(entry: OplogEntry): Promise<void> {
    if (this.closed || !this.buckets.has(entry.bucket)) return;
    const p = this.priorityFor(entry.bucket);
    if (this.priorityMax !== undefined && p > this.priorityMax) return;
    if (this.collections && !this.collections.includes(entry.collection)) return;
    if (this.paused) await this.waitForAck();
    this.send({ type: "data", priority: p, entries: [entry] });
    this.checkpoints.set(entry.bucket, entry.seq);
    this.awaitingAck = true;
  }
}
