# SPEC-017: Snapshot Postgres Reader

## Goal

Provide a concrete `SnapshotReader` that streams current rows from RBAC's Postgres read replica so `GET /sync/snapshot` can bootstrap cold-start clients.

`SPEC-012` defined the route and interface; this spec supplies the data source.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, section 8.7: snapshot endpoint.
- `docs/specs/SPEC-012.md`: `SnapshotReader` interface and route.
- `CLAUDE.md`: Postgres owned by RBAC; Sync reads replica only, never writes.

## In Scope

- Add `pg` client dependency.
- Add `PG_READ_REPLICA_URL` env var (optional; snapshot disabled if unset).
- Implement `PostgresSnapshotReader implements SnapshotReader`.
- Stream rows ordered by stable primary key using a server-side cursor.
- Filter by bucket-derived predicate (tenant + region or tenant + user).
- Map collection name to physical table + bucket column safely (no string interpolation of identifiers).

## Out of Scope

- Owning or migrating Postgres schema.
- Snapshot compression beyond existing Fastify compression.
- Pagination tokens (single stream per request).
- Write access to Postgres.

## Implementation Changes

Add to `src/config/env.ts`:

- `PG_READ_REPLICA_URL: z.string().optional()`.

Create `src/snapshot/postgresSnapshotReader.ts`:

- Constructor takes a `pg.Pool`.
- `streamCollection(params)` opens a cursor: `SELECT * FROM <table> WHERE tenant_id = $1 AND (<bucket predicate>) ORDER BY id`.
- Table + column names resolved from a static allowlist map keyed by collection (reject unknown).
- Yield rows lazily; close cursor on completion or abort.

Update `src/index.ts`:

- If `PG_READ_REPLICA_URL` set, construct pool + reader, pass into `buildApp` deps.
- If unset, snapshot route stays unregistered.

## Error Handling

- Unknown collection -> reject before query (no dynamic SQL identifiers).
- Pool/connection failure -> `DependencyUnavailableError` -> 503.
- Cursor error mid-stream -> abort stream, log request context (route already handles).

## Test Plan

- `postgresSnapshotReader.test.ts` with mocked pool/cursor:
  - Builds parameterized query with allowlisted table.
  - Rejects unknown collection without querying.
  - Yields rows then closes cursor.
  - Closes cursor on abort.
- Integration (Testcontainers Postgres): seed rows, stream, assert order + bucket filter.

## Acceptance Criteria

- Snapshot streams real rows when `PG_READ_REPLICA_URL` configured.
- No SQL identifier interpolation; collection -> table via allowlist.
- Sync never issues writes to Postgres.
- `npm run build` passes.
- `npm run test` passes.

## Follow-Up Specs

- `SPEC-019`: Local infrastructure (adds Postgres replica to compose).
- `SPEC-023`: Test suite.
