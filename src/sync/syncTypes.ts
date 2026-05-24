import type { ClientOperation } from "./syncRegistry.js";

export interface WriteRequest {
  collection: string;
  docId: string;
  operation: ClientOperation; // PUT | PATCH | REMOVE
  payload: Record<string, unknown>;
  clientTimestamp: string;
  baseSeq: number;
  clientSeq: number;
  idempotencyKey: string;
}
