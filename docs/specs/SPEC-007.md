# SPEC-007: Checkpoint Endpoint

## Goal

Add the smallest authenticated sync endpoint: `GET /sync/checkpoint`.

This endpoint lets mobile clients cheaply check whether any of their buckets have changes before issuing a pull.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, section 8.6: checkpoint endpoint.
- `SYNC_SERVICE_PLAN-v2.md`, section 8.2: tenant context attaches buckets.
- `docs/specs/SPEC-003.md`: `OplogService.getLatestSeq()`.
- `docs/specs/SPEC-006.md`: `request.user` and `request.buckets`.

## In Scope

- Add route schema for checkpoint response.
- Add `GET /sync/checkpoint`.
- Read bucket checkpoint cache from Redis when available.
- Fall back to `OplogService.getLatestSeq(buckets)`.
- Return the max visible checkpoint and bucket list.
- Add route unit tests with mocked Redis and oplog service.

## Out of Scope

- Pull entries.
- Collection filtering.
- Sync rules projection.
- Push writes.
- Snapshot bootstrapping.
- Kafka or CDC behavior.

## API Contract

Request:

```http
GET /sync/checkpoint
Authorization: Bearer <jwt>
```

Response:

```json
{
  "checkpoint": 1250,
  "buckets": ["tenant:abc-123:region:karnataka", "tenant:abc-123:user:user-456"]
}
```

Rules:

- Endpoint requires auth and tenant context.
- `checkpoint` is the highest sequence visible to the request buckets.
- `buckets` echoes the resolved bucket list for debugging and client state.

## Implementation Changes

Create `src/gateway/schemas/checkpointSchema.ts`:

- TypeBox response schema with `checkpoint: number` and `buckets: string[]`.

Create `src/gateway/routes/checkpoint.ts`:

- Register `GET /sync/checkpoint`.
- Dependencies: `OplogService`, optional Redis-like cache, and auth/context plugins already registered.
- For each bucket, try `sync:checkpoint:${bucket}`.
- Use the max cached number if all cache reads succeed and at least one value exists.
- Fall back to `oplogService.getLatestSeq(request.buckets)`.
- Return `{ checkpoint, buckets: request.buckets }`.

## Error Handling

- Redis cache failure should not fail the endpoint; fall back to Mongo/oplog.
- Oplog failure should return 503 through the centralized error handler.
- Missing bucket context should return 500 because it indicates gateway plugin misconfiguration.

## Test Plan

Add `tests/unit/checkpointRoute.test.ts`:

- Returns max checkpoint from cache.
- Falls back to oplog when cache is empty.
- Falls back to oplog when Redis throws.
- Returns resolved buckets.
- Requires authenticated request context in route setup.

## Acceptance Criteria

- `GET /sync/checkpoint` returns checkpoint and buckets.
- Redis is treated as an optimization only.
- Oplog fallback works.
- `npm run build` passes.
- `npm run test` passes.

## Follow-Up Specs

- `SPEC-008`: Sync rules engine and bucket resolver.
- `SPEC-009`: Pull endpoint.
