// SPEC-031 — interface only; scheduler deferred.
export interface BucketCompactor {
  emitMove(bucket: string, docId: string): Promise<void>;
  emitClear(bucket: string, throughSeq: number): Promise<void>;
}
