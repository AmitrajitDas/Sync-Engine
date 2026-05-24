# SPEC-010: Conflict Resolution

## Goal

Add local pre-flight conflict resolution for client writes before they are forwarded to RBAC.

Sync-side conflict handling is an optimization. RBAC remains authoritative inside `BusinessProxy.ApplyWrite`.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, section 11: conflict resolution.
- `CLAUDE.md`: field-level LWW and server-wins strategy split.
- `docs/specs/SPEC-003.md`: document replay from oplog.
- `docs/specs/SPEC-008.md`: cleaned write requests.

## In Scope

- Add conflict types.
- Add field-level last-write-wins strategy.
- Add server-wins strategy.
- Add collection-to-strategy map.
- Add `ConflictResolver` that loads server history from oplog.
- Add unit tests for LWW, server-wins, and strategy selection.

## Out of Scope

- Push endpoint.
- RBAC authoritative conflict resolution.
- CRDTs.
- UI merge flows.
- Persisting conflict records.

## Implementation Changes

Create `src/conflicts/conflictTypes.ts`:

- `ConflictContext`
- `ConflictResult`
- `ConflictStrategy`

Create `src/conflicts/strategies/lastWriteWins.ts`:

- Compare per-field client timestamp against server field timestamp.
- Prefer `_meta.field_timestamps[field]` when present.
- Fall back to row-level `updated_at`.
- Return merged payload when fields can be merged.

Create `src/conflicts/strategies/serverWins.ts`:

- Return server snapshot unchanged.
- Mark result as `server_wins`.

Create `src/conflicts/conflictResolver.ts`:

- Strategy map:
  - LWW: farms, plots, crops, gdc_submissions.
  - Server-wins: action_events, inspections, invoices, farm_members, attachments.
- Load server entries with `oplogService.replayDocument(collection, docId)`.
- If no server entries exist, return client-wins/merged payload.
- Apply configured strategy.

## Rules

- Delete conflicts use server-wins unless a later push spec defines delete-specific policy.
- Missing or malformed client timestamp falls back to server-wins.
- Unknown collection uses server-wins.
- This layer must not call RBAC.

## Test Plan

Add `tests/unit/conflictResolver.test.ts`:

- LWW overlapping fields uses newest per field.
- LWW non-overlapping fields preserves both changes.
- Server-wins returns server snapshot.
- Unknown collection uses server-wins.
- No server history allows client payload.
- Malformed timestamp uses server-wins.

## Acceptance Criteria

- Conflict strategies are isolated and testable.
- Resolver uses oplog replay rather than direct DB source-of-truth reads.
- RBAC remains authoritative and is not called here.
- `npm run build` passes.
- `npm run test` passes.

## Follow-Up Specs

- `SPEC-011`: Push endpoint and RBAC gRPC clients.
