import type { Collection } from "mongodb";
/*
 * Mongo indexes for the hot oplog access patterns.
 *
 * The oplog can grow very large, so these indexes match the questions the
 * service asks repeatedly: "changes after checkpoint", "latest version of this
 * document", "dedupe this CDC event", and "delete old history after TTL".
 */
import type { OplogEntry } from "./oplogSchema.js";

const SECONDS_PER_DAY = 86_400;

export async function ensureOplogIndexes(
  collection: Collection<OplogEntry>,
  ttlDays: number,
): Promise<void> {
  await collection.createIndexes([
    // Incremental sync path: query by seq range and user buckets, sorted old->new.
    { key: { seq: 1, bucket: 1 }, name: "seq_1_bucket_1" },
    {
      // TTL cleanup: Mongo automatically removes oplog entries older than the
      // configured retention window.
      key: { timestamp: 1 },
      name: "timestamp_ttl",
      expireAfterSeconds: ttlDays * SECONDS_PER_DAY,
    },
    // Conflict lookup: newest oplog entry for one collection/document pair.
    { key: { collection: 1, docId: 1, seq: -1 }, name: "collection_1_docId_1_seq_-1" },
    // Tenant-level history/checkpoint queries and future operational tooling.
    { key: { tenantId: 1, seq: -1 }, name: "tenantId_1_seq_-1" },
    // Client write idempotency lookup. Sparse keeps server-originated entries
    // without client fields out of the index.
    { key: { clientId: 1, clientSeq: 1 }, name: "clientId_1_clientSeq_1", sparse: true },
    // CDC redelivery idempotency. Unique+sparse means duplicate Debezium events
    // return the existing oplog row, while entries without cdcEventId are ignored.
    { key: { cdcEventId: 1 }, name: "cdcEventId_1", unique: true, sparse: true },
  ]);
}
