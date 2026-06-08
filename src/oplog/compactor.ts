/*
 * Future oplog compaction boundary.
 *
 * MOVE/CLEAR markers are part of the operation taxonomy, but scheduling and
 * implementation are deferred. Keeping the interface here documents where that
 * future behavior should attach.
 */
export interface BucketCompactor {
  emitMove(bucket: string, docId: string): Promise<void>;
  emitClear(bucket: string, throughSeq: number): Promise<void>;
}
