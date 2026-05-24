# SPEC-031: PowerSync-Style Oplog Op-Type Taxonomy (PUT/PATCH/REMOVE/MOVE/CLEAR)

## Goal

Replace the current `insert | update | delete` operation enum with the PowerSync-compatible taxonomy `PUT | PATCH | REMOVE | MOVE | CLEAR`. PowerSync clients rely on PATCH (delta) vs PUT (full doc) and on MOVE/CLEAR markers to compact local storage. Without this taxonomy a sync client cannot safely garbage-collect its local oplog.

## Source References

- `src/oplog/oplogSchema.ts:3` — current `OplogOperation`.
- `src/cdc/postgresChangeNormalizer.ts:40-53`.
- `src/gateway/schemas/pullSchema.ts:13-17` — wire format.
- `src/conflicts/strategies/lastWriteWins.ts` — strategy reads `fullDoc` vs `delta`.

## Semantics

- `PUT` — full document replacement. `fullDoc` present; `delta` may be null.
- `PATCH` — partial update. `delta` non-null; `fullDoc` optional (server-side helper, clients ignore).
- `REMOVE` — delete by id. `delta` and `fullDoc` null.
- `MOVE` — bucket-internal compaction marker. Says "all prior ops in this bucket for `docId` ≤ this `seq` may be dropped client-side". `delta` and `fullDoc` null.
- `CLEAR` — bucket reset. Says "drop everything in this bucket below this `seq`". `docId` empty. Used after a snapshot or schema migration.

## In Scope

- Wire schema migration:
  - `OplogEntry.operation` becomes the new union.
  - Existing rows in production use lowercase `insert/update/delete`; introduce a mapper layer for backward compat over the 30-day TTL window.
- CDC normalizer:
  - `c` or `r` → `PUT` (full row available).
  - `u` → `PATCH` (delta computed).
  - `d` → `REMOVE`.
- Push path:
  - Client supplies `PUT` (full replacement) or `PATCH` (delta) or `REMOVE`. Validation rejects `MOVE`/`CLEAR` from clients.
- Pull schema: response carries the new enum.
- Conflict strategies:
  - `LastWriteWinsStrategy` continues to merge `delta`/`fullDoc` regardless of op-type.
  - `REMOVE` is a tombstone; conflict-result = client wins if newer, otherwise server wins.
- Compaction producer (server side):
  - Cron job (out of scope to schedule; defined here as a function) `compactBucket(bucket, beforeSeq)` that emits a `CLEAR` followed by latest `PUT` per `docId` whose history was collapsed. Implementation deferred to follow-up; this spec defines the interface.

## Out of Scope

- The compaction scheduler itself.
- Client SDK update.

## Implementation Changes

- `src/oplog/oplogSchema.ts`:
  ```typescript
  export type OplogOperation = "PUT" | "PATCH" | "REMOVE" | "MOVE" | "CLEAR";
  ```
- `src/oplog/operationMapper.ts` (new):
  - `legacyToTaxonomy(op: "insert"|"update"|"delete"): OplogOperation`
  - `taxonomyToLegacy(op: OplogOperation): "insert"|"update"|"delete"|null`
  - Used at the wire boundary while old entries remain in the oplog (until TTL evicts them).
- `src/cdc/postgresChangeNormalizer.ts`:
  - Use new enum directly; remove the previous switch on `op` mapping to lowercase.
- `src/sync/syncTypes.ts`:
  - Add `PUT | PATCH | REMOVE` as the accepted client operations.
- `src/gateway/schemas/pullSchema.ts` and `pushSchema.ts`:
  - Update the operation `Type.Union` literals.
- `src/conflicts/conflictTypes.ts`:
  - Document tombstone semantics for `REMOVE`.
- `src/conflicts/strategies/lastWriteWins.ts`:
  - If write is `REMOVE` and clientTs > serverTs → outcome `client_wins`, payload `{}` (tombstone).
  - If server-latest is `REMOVE` and client `PUT`/`PATCH` → resurrects only if client newer (LWW); otherwise server_wins.
- `src/oplog/compactor.ts` (new, interface only):
  ```typescript
  export interface BucketCompactor {
    emitMove(bucket: string, docId: string): Promise<void>;
    emitClear(bucket: string, throughSeq: number): Promise<void>;
  }
  ```

## Error Handling

- Client push with `MOVE` or `CLEAR` → `ValidationError("client cannot emit MOVE/CLEAR")`.
- Unknown op string in oplog row → mapper logs and treats as `PUT` (defensive read of legacy data).

## Test Plan

- Unit `tests/unit/operationMapper.test.ts`:
  - All six legacy/taxonomy round-trips.
- Unit `tests/unit/postgresChangeNormalizer.test.ts`:
  - Debezium `c`/`r` → `PUT`, `u` → `PATCH`, `d` → `REMOVE`.
- Unit `tests/unit/conflictStrategies.test.ts`:
  - Client `REMOVE` with newer ts beats server `PATCH`: outcome `client_wins`, payload `{}`.
  - Server `REMOVE` with newer ts beats client `PATCH`: `server_wins`.
- Unit `tests/unit/syncRulesEngine.test.ts`:
  - `validateWrite` rejects `MOVE` and `CLEAR` from clients.

## Acceptance Criteria

- `OplogOperation` union updated, all consumers and tests compile.
- Wire schema reflects new enum.
- No mention of `insert | update | delete` outside the legacy mapper module.
- `npm run test` green; `npm run build` green.

## Follow-Up Specs

- A dedicated `compactor` spec to wire MOVE/CLEAR emission, retention sweeper, and metrics. Deferred.
