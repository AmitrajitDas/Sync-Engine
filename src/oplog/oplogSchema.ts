import type { ObjectId } from "mongodb";

/*
 * MongoDB oplog document shape.
 *
 * This collection is the sync history. Clients never read business tables
 * directly during incremental sync; they ask for oplog entries after their last
 * checkpoint and apply these operations to their local store.
 */
// SPEC-031 — PowerSync-compatible op taxonomy.
// PUT: full replacement. PATCH: partial update. REMOVE: delete (tombstone).
// MOVE / CLEAR: bucket compaction markers (server-emitted only).
export type OplogOperation = "PUT" | "PATCH" | "REMOVE" | "MOVE" | "CLEAR";
export type OplogOrigin = "server" | "client";

export interface OplogEntry {
  _id: ObjectId;
  seq: number;
  timestamp: Date;
  collection: string;
  docId: string;
  operation: OplogOperation;
  delta: Record<string, unknown> | null;
  fullDoc?: Record<string, unknown>;
  bucket: string;
  tenantId: string;
  origin: OplogOrigin;
  clientId?: string;
  clientSeq?: number;
  cdcSourceTopic?: string;
  cdcLsn?: string;
  cdcOffset?: string;
  // SPEC-026 — idempotency key for at-least-once Kafka redelivery.
  cdcEventId?: string;
}

export type NewOplogEntry = Omit<OplogEntry, "_id" | "seq">;

export const OPLOG_COLLECTION = "oplog";
