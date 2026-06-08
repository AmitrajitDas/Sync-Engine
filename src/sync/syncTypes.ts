import type { ClientOperation } from "./syncRegistry.js";

/*
 * Client write shape accepted by /sync/push.
 *
 * baseSeq says what oplog checkpoint the client edited from. clientSeq and
 * idempotencyKey let the business service/CDC path identify repeated writes.
 */
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
