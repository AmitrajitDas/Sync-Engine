import type { WriteRequest } from "../sync/syncTypes.js";
import type { OplogEntry } from "../oplog/oplogSchema.js";

/*
 * Conflict strategy contracts.
 *
 * Strategies receive the client write plus the newest server-known oplog entry
 * for the same document. They decide whether to send the client payload onward,
 * merge it, or return the server version as a conflict.
 */
export interface ConflictContext {
  write: WriteRequest;
  // SPEC-029 — bounded single-entry lookup; REMOVE entries act as tombstones (SPEC-031).
  serverLatest: OplogEntry | null;
}

export type ConflictOutcome = "client_wins" | "server_wins" | "merged";

export interface ConflictResult {
  outcome: ConflictOutcome;
  payload: Record<string, unknown>;
  serverVersion?: Record<string, unknown>;
}

export interface ConflictStrategy {
  resolve(ctx: ConflictContext): ConflictResult;
}
