# SPEC-009: Pull Endpoint

## Goal

Implement `POST /sync/pull` so authenticated mobile clients can fetch oplog deltas after a checkpoint, filtered by buckets, collections, limits, and sync-rule projections.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, section 8.4: pull endpoint.
- `docs/specs/SPEC-003.md`: `OplogService.getEntriesAfter()`.
- `docs/specs/SPEC-006.md`: auth and bucket context.
- `docs/specs/SPEC-008.md`: sync rule projection and bucket matching.

## In Scope

- Add TypeBox request/response schemas for pull.
- Add `POST /sync/pull`.
- Validate checkpoint, limit, and optional collection filter.
- Fast path using Redis bucket checkpoints.
- Query oplog for visible changes.
- Apply collection filter.
- Apply sync-rule projection.
- Return entries, checkpoint, and `hasMore`.
- Add route tests with mocked dependencies.

## Out of Scope

- Snapshot fallback.
- Push writes.
- Conflict resolution.
- RBAC gRPC calls.
- Streaming pull responses.
- Pagination tokens beyond numeric checkpoint.

## API Contract

Request:

```json
{
  "checkpoint": 0,
  "limit": 500,
  "collections": ["farms", "plots"]
}
```

Response:

```json
{
  "entries": [],
  "checkpoint": 1250,
  "hasMore": false
}
```

Rules:

- `checkpoint` defaults to `0` when omitted.
- `limit` defaults to `PULL_DEFAULT_LIMIT`.
- `limit` clamps to `PULL_MAX_LIMIT`.
- `collections` is optional; when omitted, all visible collections are eligible.
- Response `checkpoint` is the highest returned entry seq, or the request checkpoint when no entries are returned.
- `hasMore` is true when the service returns exactly the effective limit and newer entries may remain.

## Implementation Changes

Create `src/gateway/schemas/pullSchema.ts`.

Create `src/gateway/routes/pull.ts`:

- Dependencies: `OplogService`, sync rules engine, optional Redis cache.
- Read `request.buckets`.
- Fast path: if all bucket checkpoint cache values are <= client checkpoint, return empty response.
- Query `oplogService.getEntriesAfter(checkpoint, buckets, limit)`.
- Apply `collections` filter in query if the service supports it; otherwise filter before projection.
- Apply `projectFields()` to each entry.
- Compute response checkpoint and `hasMore`.

## Error Handling

- Invalid request body returns 400.
- Missing auth/bucket context returns 500.
- Oplog failure returns 503 through centralized error handler.
- Empty resolved bucket list returns empty response.

## Test Plan

Add `tests/unit/pullRoute.test.ts`:

- Pull returns entries after checkpoint.
- Pull filters by resolved buckets.
- Pull filters by requested collections.
- Pull applies field projection.
- Empty fast path returns no entries.
- Limit clamps to max.
- Response checkpoint is highest returned seq.
- Empty response preserves client checkpoint.
- Oplog errors map to 503.

## Acceptance Criteria

- `POST /sync/pull` is authenticated.
- Bucket filtering is mandatory.
- Field projection is applied before response.
- `npm run build` passes.
- `npm run test` passes.

## Follow-Up Specs

- `SPEC-010`: Conflict resolution.
- `SPEC-011`: Push endpoint and RBAC gRPC clients.
