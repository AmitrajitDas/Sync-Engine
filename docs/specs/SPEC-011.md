# SPEC-011: Push Endpoint and RBAC gRPC Clients

## Goal

Implement `POST /sync/push` so mobile clients can submit offline writes, run local validation/conflict pre-flight, and forward authorized persistence to RBAC over gRPC.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, section 8.5: push endpoint.
- `SYNC_SERVICE_PLAN-v2.md`, section 14.1: RBAC gRPC dependencies.
- `docs/specs/SPEC-008.md`: write validation.
- `docs/specs/SPEC-010.md`: conflict pre-flight.

## In Scope

- Add TypeBox schemas for push request/response.
- Add gRPC client wrappers for `RbacCheck` and `BusinessProxy`.
- Add `POST /sync/push`.
- Validate writes with sync rules.
- Run conflict pre-flight.
- Call RBAC `Check` when configured.
- Call RBAC `ApplyWrite`.
- Support idempotency fields.
- Optionally wait briefly for CDC echo via `findByClientWrite`.
- Add tests with mocked gRPC clients and oplog service.

## Out of Scope

- Defining proto contracts from scratch.
- RBAC server implementation.
- CDC consumer changes.
- Attachment operations.
- Snapshot/schema endpoints.
- Offline retry queues in mobile clients.

## API Contract

Request:

```json
{
  "clientId": "device-abc-123",
  "writes": [
    {
      "collection": "farms",
      "docId": "farm-456",
      "operation": "insert",
      "payload": {},
      "clientTimestamp": "2026-05-09T10:30:00Z",
      "baseSeq": 0,
      "clientSeq": 42,
      "idempotencyKey": "uuid"
    }
  ]
}
```

Response:

```json
{
  "results": [
    { "docId": "farm-456", "status": "applied", "serverSeq": 1250 }
  ],
  "checkpoint": 1250
}
```

## Implementation Changes

Create `src/grpc/RbacCheckClient.ts`:

- `check(user, write): Promise<boolean>`.
- Map permission denied to a typed 403 error.
- Do not retry permission failures.

Create `src/grpc/BusinessProxyClient.ts`:

- `applyWrite(request): Promise<ApplyWriteResult>`.
- Include JWT/user metadata required by RBAC.
- Pass idempotency key, client id, client seq, base seq, operation, collection, doc id, and payload.

Create `src/gateway/schemas/pushSchema.ts`.

Create `src/gateway/routes/push.ts`:

- Authenticate request.
- Validate body.
- For each write:
  - Run sync rules validation.
  - Run conflict resolver.
  - Run optional RBAC check.
  - Call `BusinessProxy.ApplyWrite`.
  - Poll `oplogService.findByClientWrite(clientId, clientSeq)` for up to 500 ms.
- Return per-write results and max checkpoint.

## Error Handling

- Invalid write returns per-write `rejected`.
- Conflict returns per-write `conflict` with `serverVersion`.
- RBAC permission failure returns per-write `rejected` or route 403 depending on whether any writes can continue.
- RBAC unavailable returns 503 so the client can retry.
- Duplicate idempotency keys should rely on RBAC for final behavior.

## Test Plan

Add `tests/unit/pushRoute.test.ts`:

- Valid write calls validation, conflict resolver, and applyWrite.
- Protected fields are stripped before gRPC.
- RBAC denied write is rejected.
- RBAC unavailable maps to 503.
- Conflict result returns conflict status.
- CDC echo polling returns `serverSeq` when found.
- No CDC echo still returns applied without `serverSeq`.

Add gRPC wrapper tests with mocked generated clients.

## Acceptance Criteria

- Push route never writes directly to Postgres.
- Push route never appends directly to oplog.
- RBAC remains authoritative for persistence and authorization.
- `npm run build` passes.
- `npm run test` passes.

## Follow-Up Specs

- `SPEC-012`: Snapshot endpoint.
- `SPEC-013`: Schema endpoint.
- `SPEC-014`: Attachment proxy.
