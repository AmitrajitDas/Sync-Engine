# SPEC-018: Oplog Index Bootstrap

## Goal

Ensure MongoDB oplog indexes (TTL expiry + query indexes) are created at startup so the oplog auto-expires after `OPLOG_TTL_DAYS` and pull/replay queries stay performant.

`oplogIndexes.ts` exists but is never invoked; without it the oplog grows unbounded and bucket queries do collection scans.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, sections 6.x: oplog storage and TTL.
- `CLAUDE.md`: MongoDB stores oplog only; TTL auto-expires after 30d.
- `src/oplog/oplogIndexes.ts`: existing index definitions.
- `src/oplog/oplogSchema.ts`: `OplogEntry` shape, `OPLOG_COLLECTION`.

## In Scope

- Review/confirm index set in `oplogIndexes.ts`:
  - TTL index on `timestamp` with `expireAfterSeconds = OPLOG_TTL_DAYS * 86400`.
  - Compound index `{ bucket: 1, seq: 1 }` for pull/replay.
  - Index `{ collection: 1, docId: 1, seq: 1 }` for `replayDocument`.
  - Index `{ clientId: 1, clientSeq: 1 }` for `findByClientWrite`.
- Add `ensureOplogIndexes(collection, ttlDays)` invocation in startup.
- Make index creation idempotent and non-fatal on already-exists.

## Out of Scope

- Changing oplog document shape.
- Sharding strategy.
- Index tuning beyond the listed access patterns.

## Implementation Changes

Update `src/oplog/oplogIndexes.ts`:

- Export `async function ensureOplogIndexes(collection, ttlDays): Promise<void>`.
- `createIndexes` with the four indexes above; TTL seconds derived from `ttlDays`.

Update `src/index.ts`:

- After Mongo connect, before `app.listen`, call `ensureOplogIndexes(oplogCollection, env.OPLOG_TTL_DAYS)`.
- Log created/confirmed indexes.

## Error Handling

- Index already exists with same spec -> treated as success.
- Index conflict (same name, different spec) -> log and throw; startup fails fast.
- Mongo unreachable at startup -> existing connect error path.

## Test Plan

- `oplogIndexes.test.ts` (Testcontainers Mongo):
  - All four indexes present after `ensureOplogIndexes`.
  - TTL index `expireAfterSeconds` matches `ttlDays * 86400`.
  - Re-running is idempotent.

## Acceptance Criteria

- Startup creates all oplog indexes.
- TTL index reflects `OPLOG_TTL_DAYS`.
- Idempotent across restarts.
- `npm run build` passes.
- `npm run test` passes.

## Follow-Up Specs

- `SPEC-023`: Test suite.
