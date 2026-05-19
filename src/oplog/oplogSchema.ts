import type { ObjectId } from "mongodb";

export type OplogOperation = "insert" | "update" | "delete";
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
}

export type NewOplogEntry = Omit<OplogEntry, "_id" | "seq">;

export const OPLOG_COLLECTION = "oplog";
