import type { Redis } from "ioredis";
/*
 * Cross-instance realtime fanout.
 *
 * Local WebSocket clients are notified directly. Redis pub/sub carries the same
 * bucket+seq notification to other Sync Engine instances so their local clients
 * hear about the change too.
 */
import type { SubscriptionRegistry } from "./subscriptionRegistry.js";
import type { OplogService } from "../oplog/oplogService.js";
import { randomUUID } from "node:crypto";

const CHANNEL = "sync:events";

interface FanoutMessage {
  bucket: string;
  seq: number;
  instanceId: string;
}

export class RedisFanout {
  private readonly instanceId = randomUUID();

  constructor(
    private readonly pub: Redis,
    private readonly sub: Redis,
    private readonly registry: SubscriptionRegistry,
    // SPEC-034 — used to fetch the full entry for stream sessions on remote events.
    private readonly oplog?: OplogService,
  ) {}

  async start(): Promise<void> {
    await this.sub.subscribe(CHANNEL);
    this.sub.on("message", (_channel: string, raw: string) => {
      let msg: FanoutMessage;
      try {
        msg = JSON.parse(raw) as FanoutMessage;
      } catch {
        return;
      }
      // Dedupe self-published messages (local registry already notified directly).
      if (msg.instanceId === this.instanceId) return;
      this.registry.notify(msg.bucket, msg.seq);
      void this.deliverRemoteToSessions(msg.bucket, msg.seq);
    });
  }

  private async deliverRemoteToSessions(bucket: string, seq: number): Promise<void> {
    const sessions = this.registry.deliverToSessions(bucket, seq);
    if (sessions.length === 0 || !this.oplog) return;
    // SPEC-034 — pub/sub carries only {bucket,seq}; fetch the entry by seq.
    const entries = await this.oplog.getEntriesAfter(seq - 1, [bucket], { limit: 1 });
    const entry = entries.find((e) => e.seq === seq);
    if (!entry) return;
    await Promise.allSettled(sessions.map((s) => s.deliver(entry)));
  }

  async publish(bucket: string, seq: number): Promise<void> {
    const msg: FanoutMessage = { bucket, seq, instanceId: this.instanceId };
    await this.pub.publish(CHANNEL, JSON.stringify(msg));
  }

  async stop(): Promise<void> {
    await this.sub.unsubscribe(CHANNEL);
  }
}
