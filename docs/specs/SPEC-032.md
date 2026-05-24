# SPEC-032: PowerSync-Style Bucket Checksums

## Goal

Add per-bucket running checksums so mobile clients can detect local-state corruption or lost ops and request a targeted re-snapshot rather than a full rebuild.

PowerSync uses a 32-bit additive checksum (`sum mod 2^32`) over the deterministic hash of each oplog entry, exposed alongside the bucket's checkpoint.

## Source References

- `src/oplog/oplogSchema.ts`, `src/eventbus/consumers/OplogConsumer.ts` — checksum updated when oplog grows.
- `src/gateway/routes/pull.ts` and `checkpoint.ts` — response carries per-bucket checksum.
- SPEC-026 (atomic-max cache helper) — same Redis path is extended.

## Semantics

- Per bucket: `checksum_n = (checksum_{n-1} + h(entry_n)) mod 2^32`.
- `h(entry)` = 32-bit FNV-1a of canonical JSON of `{ seq, collection, docId, operation, delta, fullDoc }`.
- Stored in Redis: hash `sync:checksum:<bucket>` with fields `seq` and `csum`.
- Persisted on every oplog append; never recomputed from scratch in the hot path.

## In Scope

- New `src/oplog/bucketChecksum.ts`:
  - `hashEntry(entry: OplogEntry): number` — FNV-1a over canonical JSON.
  - `BucketChecksum`:
    - `update(bucket, entry): Promise<{ seq, csum }>` — Redis Lua: atomic CAS based on max-seq guard.
    - `get(bucket): Promise<{ seq, csum } | null>`.
- `OplogConsumer.handle` writes the checksum after persisting.
- Pull and checkpoint responses include `bucketStates: Record<bucket, { seq, csum }>`.
- `PullRequest` body accepts optional `bucketStates: Record<bucket, { seq, csum }>` so the server can detect mismatch.
- Server-side reconciliation: when client supplies a `{seq, csum}` for a bucket that does not match server's stored value at the same `seq`, the response sets `bucketStates[bucket].mismatch: true`; client triggers a snapshot for that bucket.

## Out of Scope

- Re-snapshot trigger flow (covered by existing `/sync/snapshot`).
- Multi-region cluster-wide checksum reconciliation.

## Implementation Changes

- `src/oplog/bucketChecksum.ts` new.
- `src/eventbus/consumers/OplogConsumer.ts`:
  - After `appendToOplog`, call `BucketChecksum.update`.
- `src/gateway/schemas/pullSchema.ts`:
  - Add `bucketStates: Optional(Record(string, { seq: number, csum: number }))` on request.
  - Response gains `bucketStates: Record(string, { seq: number, csum: number, mismatch?: boolean })`.
- `src/gateway/schemas/checkpointSchema.ts`:
  - Response `bucketStates: Record(...)`.
- `src/gateway/routes/pull.ts` and `checkpoint.ts`:
  - Read `BucketChecksum.get` per bucket in parallel.
  - Compare against client-supplied states; mark mismatches.
- Metrics:
  - `sync_bucket_checksum_mismatch_total` (Counter, label `bucket`).

## Error Handling

- Checksum store unavailable: pull/checkpoint succeed but omit `bucketStates` (do not block sync on a derived signal).
- Client-supplied `seq` ahead of server: ignore (will be reconciled next pull).

## Test Plan

- Unit `tests/unit/bucketChecksum.test.ts`:
  - `hashEntry` deterministic.
  - `update` accumulates correctly across many sequential entries.
  - Two parallel `update` calls (different seqs) converge to the same final value as sequential — by virtue of Redis Lua atomicity.
- Unit `tests/unit/pullRoute.test.ts`:
  - Client supplies matching `{seq, csum}` → no `mismatch` flag.
  - Client supplies wrong `csum` → response carries `mismatch: true` for that bucket; counter incremented.
- Integration `tests/integration/checksumRecover.test.ts`:
  - Corrupt client local state simulation: send mismatching csum → server flags; client subsequent snapshot resyncs cleanly.

## Acceptance Criteria

- Every oplog append updates the corresponding bucket checksum atomically.
- Pull and checkpoint expose `bucketStates`.
- Mismatch detection works end-to-end.
- `npm run test` green; `npm run build` green.

## Follow-Up Specs

- SPEC-033 priority buckets uses the same `bucketStates` envelope.
- SPEC-034 streaming pull carries `bucketStates` in checkpoint frames.
