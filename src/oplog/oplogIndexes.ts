import type { Collection } from "mongodb";
import type { OplogEntry } from "./oplogSchema.js";

const SECONDS_PER_DAY = 86_400;

/**
 * Idempotent index creation for the oplog collection.
 *
 * `createIndexes` is safe to call repeatedly: Mongo no-ops when an index with
 * the same name and spec already exists. The TTL index drives the 30d auto
 * expiry from config (`OPLOG_TTL_DAYS`).
 *
 * No unique index on `{ clientId, clientSeq }` yet — client-write idempotency
 * policy is finalized in the push spec.
 */
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
  ]);
}
