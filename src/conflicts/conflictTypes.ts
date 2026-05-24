import type { WriteRequest } from "../sync/syncTypes.js";
import type { OplogEntry } from "../oplog/oplogSchema.js";

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
