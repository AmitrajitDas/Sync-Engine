import type { Collection } from "mongodb";
import type { OplogEntry } from "./oplogSchema.js";

const SECONDS_PER_DAY = 86_400;

export async function ensureOplogIndexes(
  collection: Collection<OplogEntry>,
  ttlDays: number,
): Promise<void> {
  await collection.createIndexes([
    { key: { seq: 1, bucket: 1 }, name: "seq_1_bucket_1" },
    {
      key: { timestamp: 1 },
      name: "timestamp_ttl",
      expireAfterSeconds: ttlDays * SECONDS_PER_DAY,
    },
    { key: { collection: 1, docId: 1, seq: -1 }, name: "collection_1_docId_1_seq_-1" },
    { key: { tenantId: 1, seq: -1 }, name: "tenantId_1_seq_-1" },
    { key: { clientId: 1, clientSeq: 1 }, name: "clientId_1_clientSeq_1", sparse: true },
    // SPEC-026 — idempotency on CDC redelivery.
    { key: { cdcEventId: 1 }, name: "cdcEventId_1", unique: true, sparse: true },
  ]);
}
