# SPEC-016: gRPC Proto Contracts and Client Wiring

## Goal

Define the proto contracts Sync depends on from RBAC, generate typed stubs, and connect the three gRPC client wrappers so push, snapshot authorization, and attachment proxying become functional.

This unblocks `SPEC-011`, `SPEC-012`, and `SPEC-014`, which currently throw `DependencyUnavailableError`.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, section 14.1: RBAC gRPC dependencies (`RbacCheck`, `BusinessProxy`, `AttachmentGrpc`).
- `CLAUDE.md`: `proto/` mirrors RBAC repo; circuit breaker (opossum) on all RBAC gRPC.
- `docs/specs/SPEC-011.md`: `RbacCheckClient`, `BusinessProxyClient`.
- `docs/specs/SPEC-014.md`: `AttachmentClient`.
- `src/grpc/circuitBreaker.ts`: existing breaker factory (built, unused).

## In Scope

- Add `proto/rbac.proto` mirroring the RBAC contract.
- Define `RbacCheck` (`Check`, `CheckBatch`), `BusinessProxy` (`ApplyWrite`), `AttachmentGrpc` (`Presign`, `GetDownloadUrl`).
- Wire `npm run proto:gen` output in `src/grpc/generated/`.
- Replace stub bodies in `RbacCheckClient`, `BusinessProxyClient`, `AttachmentClient` with real gRPC calls against generated stubs.
- Apply `createGrpcCircuitBreaker` to every RBAC call path.
- Pass JWT/user metadata in gRPC call credentials.
- Enforce per-call deadline from `RBAC_GRPC_TIMEOUT_MS`.

## Out of Scope

- RBAC server implementation.
- Proto source-of-truth ownership (RBAC owns it; this mirrors).
- Retry/backoff tuning beyond `SPEC-020`.
- WebSocket or schema-coordination work.

## Implementation Changes

Create `proto/rbac.proto`:

- `service RbacCheck { rpc Check(CheckRequest) returns (CheckResponse); rpc CheckBatch(CheckBatchRequest) returns (CheckBatchResponse); }`
- `service BusinessProxy { rpc ApplyWrite(ApplyWriteRequest) returns (ApplyWriteResponse); }`
- `service AttachmentGrpc { rpc Presign(PresignRequest) returns (PresignResponse); rpc GetDownloadUrl(DownloadUrlRequest) returns (DownloadUrlResponse); }`
- Messages carry `tenant_id`, `user_id`, `roles`, `collection`, `operation`, `doc_id`, `payload` (JSON string or `google.protobuf.Struct`), `idempotency_key`, `client_id`, `client_seq`, `base_seq`.

Update `src/grpc/RbacCheckClient.ts`, `BusinessProxyClient.ts`, `AttachmentClient.ts`:

- Construct generated client against `RBAC_GRPC_ADDRESS`.
- Wrap each method in a circuit breaker (open at 50% failures / 10s).
- Map gRPC status to typed errors (existing `mapGrpcError`).
- Attach user metadata via `grpc.Metadata`.

Update `src/index.ts`:

- Construct clients with shared channel/credentials.

## Error Handling

- `PERMISSION_DENIED` -> 403, never retried, never trips breaker.
- `INVALID_ARGUMENT` -> per-write `rejected`, never retried.
- `UNAVAILABLE` / `DEADLINE_EXCEEDED` -> 503, breaker counts it.
- Breaker open -> 503 fast-fail.

## Test Plan

- `rbacCheckClient.test.ts`: maps statuses, attaches metadata, respects deadline.
- `businessProxyClient.test.ts`: forwards payload + idempotency, maps reject vs unavailable.
- `attachmentClient.test.ts`: presign/download forwarding, error mapping.
- Breaker test: opens after threshold, fast-fails while open, half-open recovery.
- Proto round-trip: generated types compile and serialize.

## Acceptance Criteria

- `proto/rbac.proto` exists; `npm run proto:gen` populates `src/grpc/generated/`.
- All three clients perform real gRPC calls.
- Every RBAC call path is breaker-wrapped.
- No client throws `DependencyUnavailableError` as a placeholder.
- `npm run build` passes.
- `npm run test` passes.

## Follow-Up Specs

- `SPEC-017`: Snapshot Postgres reader.
- `SPEC-020`: Production hardening fixes.
- `SPEC-023`: Test suite.
