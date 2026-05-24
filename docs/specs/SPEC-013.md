# SPEC-013: Client Schema Endpoint

## Goal

Add `GET /sync/schema` so mobile clients can fetch versioned SQLite DDL and migrations for local offline storage.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, section 8.8: schema endpoint.
- `CLAUDE.md`: client schema is versioned in `src/sync/clientSchema.ts`.

## In Scope

- Add static client schema registry.
- Add schema version metadata.
- Add migration lookup between supported versions.
- Add `GET /sync/schema?version=N`.
- Add response schemas and tests.

## Out of Scope

- Running migrations on the client.
- Generating schema from Postgres.
- Dynamic runtime schema editing.
- Backward compatibility beyond explicitly listed migrations.

## API Contract

Request:

```http
GET /sync/schema?version=6
```

Response:

```json
{
  "version": 7,
  "ddl": ["CREATE TABLE farms (...)"],
  "migrations": {
    "6_to_7": ["ALTER TABLE farms ADD COLUMN ..."]
  }
}
```

## Implementation Changes

Create `src/sync/clientSchema.ts`:

- `CURRENT_SCHEMA_VERSION`.
- `ddl` array for full schema creation.
- `migrations` map keyed by `<from>_to_<to>`.
- `getSchemaResponse(clientVersion?: number)`.

Create `src/gateway/schemas/schemaSchema.ts`.

Create `src/gateway/routes/schema.ts`:

- Parse optional `version` query.
- Return full DDL and required migrations.
- If version equals current version, return empty migrations.

## Rules

- Schema endpoint is authenticated.
- Unsupported future client version returns 400.
- Unsupported old version returns 426 or 400 with clear upgrade message.
- DDL statements are static strings reviewed in git.

## Test Plan

Add `tests/unit/clientSchema.test.ts`:

- Current version returns DDL and empty migrations.
- Prior version returns needed migration path.
- Future version fails.
- Unsupported old version fails.

Add `tests/unit/schemaRoute.test.ts`:

- Valid query returns schema response.
- Invalid version returns 400.

## Acceptance Criteria

- Client schema is versioned in code.
- Endpoint returns deterministic JSON.
- `npm run build` passes.
- `npm run test` passes.

## Follow-Up Specs

- `SPEC-014`: Attachment proxy.
- `SPEC-015`: Production hardening and operations.
