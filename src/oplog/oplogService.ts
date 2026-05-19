import type { Collection } from "mongodb";
import type { NewOplogEntry, OplogEntry } from "./oplogSchema.ts";
import type { SequenceGenerator } from "./sequenceGenerator.ts";

export interface OplogServiceOptions {
  defaultLimit?: number;
  maxLimit?: number;
}

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;

export class OplogService {
  private readonly defaultLimit: number;
  private readonly maxLimit: number;

  constructor(
    private readonly collection: Collection<OplogEntry>,
    private readonly sequenceGenerator: SequenceGenerator,
    options: OplogServiceOptions = {},
  ) {
    this.defaultLimit = options.defaultLimit ?? DEFAULT_LIMIT;
    this.maxLimit = options.maxLimit ?? MAX_LIMIT;
  }

  /**
   * Assigns the next monotonic seq, inserts, and returns the persisted entry.
   * Driver errors surface to the caller; no retry here.
   */
  async appendToOplog(entry: NewOplogEntry): Promise<OplogEntry> {
    const seq = await this.sequenceGenerator.nextSeq();
    const doc = { ...entry, seq } as OplogEntry;
    const result = await this.collection.insertOne(doc);
    return { ...doc, _id: result.insertedId };
  }

  async getEntriesAfter(
    seq: number,
    buckets: string[],
    limit?: number,
  ): Promise<OplogEntry[]> {
    if (buckets.length === 0) return [];
    return this.collection
      .find({ seq: { $gt: seq }, bucket: { $in: buckets } })
      .sort({ seq: 1 })
      .limit(this.clampLimit(limit))
      .toArray();
  }

  async getLatestSeq(buckets?: string[]): Promise<number> {
    const filter =
      buckets && buckets.length > 0 ? { bucket: { $in: buckets } } : {};
    const latest = await this.collection
      .find(filter)
      .sort({ seq: -1 })
      .limit(1)
      .next();
    return latest?.seq ?? 0;
  }

  replayFromSeq(seq: number, buckets: string[]): AsyncIterable<OplogEntry> {
    if (buckets.length === 0) return emptyAsyncIterable();
    return this.collection
      .find({ seq: { $gt: seq }, bucket: { $in: buckets } })
      .sort({ seq: 1 });
  }

  async replayDocument(
    collection: string,
    docId: string,
  ): Promise<OplogEntry[]> {
    return this.collection
      .find({ collection, docId })
      .sort({ seq: 1 })
      .toArray();
  }

  replayFromTimestamp(
    from: Date,
    buckets?: string[],
  ): AsyncIterable<OplogEntry> {
    const filter: Record<string, unknown> = { timestamp: { $gte: from } };
    if (buckets) {
      if (buckets.length === 0) return emptyAsyncIterable();
      filter.bucket = { $in: buckets };
    }
    return this.collection.find(filter).sort({ seq: 1 });
  }

  async findByClientWrite(
    clientId: string,
    clientSeq: number,
  ): Promise<OplogEntry | null> {
    return this.collection.findOne({ clientId, clientSeq });
  }

  private clampLimit(limit?: number): number {
    if (limit === undefined || limit <= 0) return this.defaultLimit;
    return Math.min(limit, this.maxLimit);
  }
}

function emptyAsyncIterable<T>(): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      /* yields nothing */
    },
  };
}
