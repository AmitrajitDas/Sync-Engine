# SPEC-030: Minor Bug-Fix Cleanup Batch

## Goal

Roll up the smaller defects and drift points from the codebase audit that are too small to deserve their own spec but should not be lost.

## Source References

Per-item code locations are cited inline below.

## In Scope

1. **Write rules drift from plan** (`src/sync/syncRules.ts:44-49`)
   - Plan §9.1 specified `ownershipCheck: (w, u) => w.payload.region === u.region` for `farms`. Implementation uses `ownershipField: "created_by"`. Resolve by:
     - Keep `ownershipField` model.
     - Drop `region` from `protectedFields` for `farms` so a region ownership check could exist if added later (not added in this spec).
     - Document the intentional change at top of `syncRules.ts`.

2. **Schema endpoint open when JWKS unset** (`src/app.ts:145-147`)
   - When `JWKS_URL` is not set, the auth plugin is not registered but `/sync/schema` still mounts. Make `schemaRoutes` registration conditional on auth being registered, OR explicitly mark it as a public endpoint and register it under `/public/schema` mirror. Choose: keep `/sync/schema` private — only register when auth is registered.

3. **Schema kill-switch returns version=0** (`src/sync/clientSchema.ts:155`)
   - `CURRENT_SCHEMA_VERSION = 1`; `killSwitch=true` → returns version=0 with no DDL.
   - Guard: `targetVersion = Math.max(MIN_SUPPORTED_VERSION, CURRENT_SCHEMA_VERSION - 1)`.
   - Add explicit test for the `CURRENT_SCHEMA_VERSION === MIN_SUPPORTED_VERSION` case.

4. **Tenant context silent on missing user** (`src/gateway/plugins/tenantContext.ts:9`)
   - When `request.user` absent on a `/sync/*` route, throw `AuthError("no user context on /sync route")` instead of returning silently. Prevents the "No bucket context" Error 500 in downstream routes.

5. **Snapshot query schema not wired** (`src/gateway/routes/snapshot.ts:33`)
   - Attach `SnapshotQuerySchema` via `schema: { querystring: ... }` on the route options.
   - Remove the manual `if (!requestedBucket)` check since the schema enforces required.

6. **Snapshot `user` NPE risk** (`src/gateway/routes/snapshot.ts:100`)
   - Add explicit assertion `if (!user) throw new AuthError(...)` at route entry. Defense-in-depth even though auth plugin is mandatory.

7. **BusinessProxy `client_id` field**
   - Already covered by SPEC-025. Cross-referenced.

8. **gRPC `keepalive_timeout_ms` reuse of `timeoutMs`** (`src/grpc/protoLoader.ts:42-46`, etc.)
   - `keepalive_timeout_ms = timeoutMs` couples request timeout to keepalive ping timeout. They are different concerns. Use a constant `KEEPALIVE_TIMEOUT_MS = 10_000`.

9. **Graceful shutdown waits the full budget unconditionally** (`src/lifecycle/gracefulShutdown.ts:36`)
   - Replace blind `setTimeout` with an active gRPC in-flight counter, exposed by the gRPC client wrappers. On shutdown, wait until `counter === 0 || deadline`.
   - In-flight tracking: per-client `private inflight = 0; increment before fire, decrement in finally`. Expose `app.decorate("grpcInflight", () => sum)`.

10. **OplogConsumer wildcard cache** — partially covered by SPEC-026 (atomic-max + wildcard write). Re-confirmed here.

11. **`src/oplog/oplogService.ts` uses `.ts` import extensions** (lines 2-3) — should be `.js` per CLAUDE.md NodeNext rules.

12. **`SchemaResponseSchema` `policy` always returned**: confirm `schema.ts` includes `policy` field on every response path (it does); add a test.

## Out of Scope

- Splitting any of the above into their own specs.
- Larger structural refactors of `syncRules`.

## Implementation Changes

Per item above. Each is a small localized change.

## Error Handling

- Item 4: `AuthError` (existing class) — error handler already maps to 401.
- Item 9: gRPC counter must never go negative — use atomic increment/decrement in a small helper.

## Test Plan

- `tests/unit/syncRules.test.ts`: writeRules import smoke + protected-fields list assertion for `farms` (no `region`).
- `tests/unit/clientSchema.test.ts`: killSwitch + `CURRENT_SCHEMA_VERSION=1` returns version=1 (clamped).
- `tests/unit/tenantContext.test.ts`: missing `request.user` on `/sync/pull` → 401 AuthError.
- `tests/unit/snapshot.test.ts`: missing `bucket` query rejected by schema (400), not by handler.
- `tests/unit/gracefulShutdown.test.ts`: simulate 2 in-flight, then 0; shutdown returns once counter hits 0 even before deadline.
- `tests/unit/schemaRoute.test.ts`: when auth plugin not registered, `schemaRoutes` not mounted (assert via route table).

## Acceptance Criteria

- Each item above lands as a focused commit.
- `npm run test` green.
- `npm run build` green.
- No new TODO comments left behind.

## Follow-Up Specs

- None — closes the long tail of the audit.
