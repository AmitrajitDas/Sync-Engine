# SPEC-022: Schema Migration Coordination at Scale

## Goal

Move beyond the basic version-diff in `clientSchema.ts` to coordinate SQLite schema migrations across millions of offline clients: staged rollout, version-distribution telemetry, and explicit forced-upgrade vs soft-migrate policy.

Plan §18 previously scoped this as "basic version-diff only". Now in scope.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, section 8.8: schema endpoint.
- `SYNC_SERVICE_PLAN-v2.md`, section 18: previously out-of-scope migration coordination.
- `docs/specs/SPEC-013.md`: `clientSchema.ts`, `getSchemaResponse`.
- `src/sync/clientSchema.ts`: current static DDL + migration map.

## In Scope

- Per-version-gap policy: `soft` (apply migrations, keep syncing), `forced` (client must upgrade before sync), `blocked` (version unsupported).
- Staged rollout: gate a new `CURRENT_SCHEMA_VERSION` behind a rollout percentage / kill-switch (config-driven, no redeploy to halt).
- Version-distribution telemetry: counter of requests by reported client schema version.
- `/sync/schema` response carries `policy` and `minSupportedVersion` so clients self-gate.
- Migration validation: every `<n>_to_<n+1>` path present and contiguous up to current; build-time assertion.

## Out of Scope

- Running migrations on the client (client responsibility).
- Generating schema from Postgres.
- Data backfill execution (policy/signaling only; transforms remain client-applied DDL).
- Dynamic runtime DDL editing.

## Implementation Changes

Add config (`src/config/env.ts`):

- `SCHEMA_ROLLOUT_PERCENT` (default 100).
- `SCHEMA_MIN_SUPPORTED_VERSION` (default `MIN_SUPPORTED_VERSION`).
- `SCHEMA_KILL_SWITCH` (bool; if true, serve previous version).

Update `src/sync/clientSchema.ts`:

- `resolveTargetVersion(clientId|requestHash)`: deterministic bucketing for staged rollout.
- `getSchemaResponse(clientVersion, ctx)`: returns `{ version, ddl, migrations, policy, minSupportedVersion }`.
- `policy` = `blocked` if `< min`, `forced` if gap exceeds `FORCED_UPGRADE_THRESHOLD`, else `soft`.
- Build-time check: contiguous migration keys `1_to_2 … (n-1)_to_n`.

Update `src/gateway/routes/schema.ts`:

- Pass rollout/kill-switch context.
- Increment `schemaVersionDistribution` metric labeled by reported version.
- `blocked` -> 426; `forced` -> 200 with `policy: "forced"` (client decides).

Add metric (`src/observability/metrics.ts`):

- `sync_client_schema_version_total{version}` counter.

## Error Handling

- Reported version > server current -> 400 (client newer than server).
- Reported version < min supported -> 426 with upgrade message.
- Kill-switch on -> serve last-known-good version, log warn.

## Test Plan

- `clientSchema.test.ts`: policy selection (soft/forced/blocked); contiguous-migration assertion fails on gap.
- Rollout: deterministic bucketing, same input -> same target; percent boundary respected.
- `schemaRoute.test.ts`: metric incremented per version; kill-switch serves previous; 426 on too-old.

## Acceptance Criteria

- Migration paths validated contiguous at build time.
- Staged rollout gateable without redeploy (config + kill-switch).
- Client version distribution observable via metrics.
- Policy (`soft`/`forced`/`blocked`) returned per client.
- `npm run build` passes.
- `npm run test` passes.

## Follow-Up Specs

- `SPEC-023`: Test suite.
