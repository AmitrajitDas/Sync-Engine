import type { Collection, MongoServerError } from "mongodb";
/*
 * Oplog data-access layer.
 *
 * Routes and consumers should use this class instead of querying Mongo
 * directly. That keeps checkpoint paging, idempotent inserts, and latest-doc
 * conflict lookups consistent across the service.
 */
import type { NewOplogEntry, OplogEntry } from "./oplogSchema.js";
import type { SequenceGenerator } from "./sequenceGenerator.js";

export interface OplogServiceOptions {
  defaultLimit?: number;
  maxLimit?: number;
}

export interface GetEntriesAfterOptions {
  limit?: number;
  collections?: string[];
}

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;
const MONGO_DUPLICATE_KEY = 11000;

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
   * SPEC-026: on E11000 duplicate cdcEventId, return the existing row (idempotent).
   */
  async appendToOplog(entry: NewOplogEntry): Promise<OplogEntry> {
    const seq = await this.sequenceGenerator.nextSeq();
    const doc = { ...entry, seq } as OplogEntry;
    try {
      const result = await this.collection.insertOne(doc);
      return { ...doc, _id: result.insertedId };
    } catch (err) {
      const mongoErr = err as MongoServerError;
      if (mongoErr?.code === MONGO_DUPLICATE_KEY && entry.cdcEventId) {
        const existing = await this.collection.findOne({ cdcEventId: entry.cdcEventId });
        if (existing) return existing;
      }
      throw err;
    }
  }

  async getEntriesAfter(
    seq: number,
    buckets: string[],
    optsOrLimit?: number | GetEntriesAfterOptions,
  ): Promise<OplogEntry[]> {
    if (buckets.length === 0) return [];
    // Incremental sync query: "for these buckets, give me changes after seq N
    // in increasing seq order, optionally limited to certain collections."
    const options: GetEntriesAfterOptions =
      typeof optsOrLimit === "number" ? { limit: optsOrLimit } : optsOrLimit ?? {};
    const filter: Record<string, unknown> = {
      seq: { $gt: seq },
      bucket: { $in: buckets },
    };
    if (options.collections && options.collections.length > 0) {
      filter.collection = { $in: options.collections };
    }
    return this.collection
      .find(filter)
      .sort({ seq: 1 })
      .limit(this.clampLimit(options.limit))
      .toArray();
  }

  async getLatestSeq(buckets?: string[]): Promise<number> {
    // Checkpoint query: latest visible sequence for the whole service or for a
    // user's accessible buckets.
    const filter =
      buckets && buckets.length > 0 ? { bucket: { $in: buckets } } : {};
    const latest = await this.collection
      .find(filter)
      .sort({ seq: -1 })
      .limit(1)
      .next();
    return latest?.seq ?? 0;
  }

  // SPEC-029
  async getLatestForDocument(
    collection: string,
    docId: string,
  ): Promise<OplogEntry | null> {
    // Conflict-resolution query: find the newest known server version of one
    // logical document without replaying the whole document history.
    return this.collection
      .find({ collection, docId })
      .sort({ seq: -1 })
      .limit(1)
      .next();
  }

  // SPEC-027 — generator wrapper so caller's break closes the cursor.
  replayFromSeq(seq: number, buckets: string[]): AsyncIterable<OplogEntry> {
    if (buckets.length === 0) return emptyAsyncIterable();
    const coll = this.collection;
    return {
      async *[Symbol.asyncIterator]() {
        const cursor = coll.find({ seq: { $gt: seq }, bucket: { $in: buckets } }).sort({ seq: 1 });
        try {
          for await (const doc of cursor) yield doc;
        } finally {
          await cursor.close();
        }
      },
    };
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
    const coll = this.collection;
    return {
      async *[Symbol.asyncIterator]() {
        const cursor = coll.find(filter).sort({ seq: 1 });
        try {
          for await (const doc of cursor) yield doc;
        } finally {
          await cursor.close();
        }
      },
    };
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
