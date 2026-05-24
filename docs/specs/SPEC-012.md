# SPEC-012: Snapshot Endpoint

## Goal

Add a bootstrap endpoint for clients that need a full state snapshot instead of replaying old oplog entries.

Snapshots are for checkpoint `0` clients or clients whose required history is older than the oplog TTL.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, section 8.7: snapshot endpoint.
- `docs/specs/SPEC-006.md`: auth and bucket context.
- `docs/specs/SPEC-008.md`: sync rules and field projection.

## In Scope

- Add `GET /sync/snapshot`.
- Validate bucket and collection query parameters.
- Authorize per collection through RBAC check client.
- Read from configured Postgres read replica abstraction.
- Stream NDJSON response.
- Return or include `snapshotSeq` so clients resume from oplog.
- Add tests with mocked Postgres reader and authz client.

## Out of Scope

- Managing Postgres schema.
- Owning RBAC source-of-truth data.
- Bulk binary export formats.
- Client SQLite implementation.
- Snapshot compression beyond existing Fastify compression plugin.

## API Contract

Request:

```http
GET /sync/snapshot?bucket=tenant:abc:region:karnataka&collections=farms,plots
```

Response:

- Content type: `application/x-ndjson`
- Each line is a projected row envelope.
- Final metadata line includes `snapshotSeq`.

## Implementation Changes

Create `src/gateway/schemas/snapshotSchema.ts`.

Create `src/gateway/routes/snapshot.ts`:

- Require auth.
- Validate requested bucket is included in `request.buckets` or matched by tenant wildcard.
- Validate requested collections against sync rules.
- Check RBAC authorization per collection.
- Fetch current latest sequence from oplog before streaming.
- Stream rows ordered by stable primary key.
- Apply sync-rule projection.
- End stream with snapshot metadata.

Create a `SnapshotReader` interface:

```ts
export interface SnapshotReader {
  streamCollection(params: SnapshotReadParams): AsyncIterable<Record<string, unknown>>;
}
```

## Error Handling

- Unauthorized bucket returns 403.
- Unknown collection returns 400.
- RBAC unavailable returns 503.
- Reader failure aborts stream and logs request context.

## Test Plan

Add `tests/unit/snapshotRoute.test.ts`:

- Rejects bucket outside user context.
- Streams rows for allowed collection.
- Applies projection.
- Includes snapshot sequence.
- RBAC denial returns 403.
- Unknown collection returns 400.

## Acceptance Criteria

- Snapshot endpoint is authenticated.
- Snapshot does not bypass bucket authorization.
- Snapshot uses projection rules.
- `npm run build` passes.
- `npm run test` passes.

## Follow-Up Specs

- `SPEC-013`: Schema endpoint.
- `SPEC-014`: Attachment proxy.
