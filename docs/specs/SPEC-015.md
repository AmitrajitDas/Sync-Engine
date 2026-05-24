# SPEC-015: Production Hardening and Operations

## Goal

Prepare the Sync Engine for production operation after core sync flows are implemented.

This spec covers rate limiting, readiness checks, metrics, tracing, graceful shutdown, resilience, logging, and documentation.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, section 12: production readiness.
- `SYNC_SERVICE_PLAN-v2.md`, section 14: RBAC integration and failure modes.
- `SYNC_SERVICE_PLAN-v2.md`, section 16: ADRs to write.
- `CLAUDE.md`: expected commands, integration boundaries, and operational ownership.

## In Scope

- Add rate limiting with Redis store.
- Add liveness and readiness routes.
- Add Prometheus-style metrics.
- Add OpenTelemetry tracing hooks.
- Add graceful shutdown orchestration.
- Add gRPC resilience policies.
- Standardize structured logging fields.
- Add README and ADRs.

## Out of Scope

- Kubernetes manifests.
- Terraform or cloud resources.
- Full load-test suite implementation.
- Production dashboards.
- Alert manager configuration.

## Implementation Changes

Rate limiting:

- Use `@fastify/rate-limit`.
- Pull: 200/min/user.
- Push: 60/min/user.
- Snapshot: 5/min/user.
- Use per-IP fallback before auth context exists.

Health checks:

- `GET /health/live`: process is alive.
- `GET /health/ready`: Mongo, Redis, Kafka consumer, and RBAC gRPC are reachable.

Metrics:

- HTTP latency by route and status.
- Pull/push/snapshot p50/p95/p99.
- Oplog query count and returned row count.
- CDC consumer lag.
- Conflict rate per collection.
- gRPC duration and error count.
- Bucket distribution counters.

Tracing:

- Add OpenTelemetry setup.
- Propagate trace context from HTTP to gRPC.
- Include span attributes: `tenant.id`, `user.id`, `bucket`, `collection`, `client.id`.

Graceful shutdown:

- On SIGTERM/SIGINT:
  - stop accepting HTTP.
  - stop Kafka consumer and commit offsets.
  - wait up to 10 seconds for in-flight gRPC.
  - close Mongo, Redis, Kafka, and Fastify.

Resilience:

- Add gRPC circuit breaker behavior.
- Retry only `UNAVAILABLE` with exponential backoff and jitter.
- Never retry `PERMISSION_DENIED` or `INVALID_ARGUMENT`.
- Push returns 503 when RBAC is unavailable; pull can continue from local oplog.

Logging:

- Use Pino structured JSON.
- Include `tenant_id`, `user_id`, `request_id`, `trace_id`, `route`, and `latency_ms`.
- Never log raw JWTs or secrets.

Documentation:

- Add `README.md` with setup, dev, test, and local infra commands.
- Add ADRs:
  - Postgres source of truth, Mongo oplog.
  - Debezium CDC vs app dual-write.
  - EventBus interface.
  - Kafka-only broker.
  - gRPC to RBAC vs HTTP.
  - Field-level LWW.
  - Snapshot vs replay.
  - Kafka offset resume persistence.

## Test Plan

- Unit test readiness checks with healthy and failing dependencies.
- Unit test rate-limit key generation.
- Unit test graceful shutdown calls dependencies in order.
- Unit test gRPC retry policy only retries allowed status codes.
- Integration smoke test: app starts with local Docker infrastructure.
- Existing test suite passes.

## Acceptance Criteria

- Production health endpoints are present.
- Readiness detects dependency failures.
- Rate limits are route-aware.
- Logs are structured and redact sensitive values.
- Shutdown is deterministic.
- README and ADRs exist.
- `npm run build` passes.
- `npm run test` passes.

## Final Verification

Run:

```bash
npm run build
npm run test
docker compose config
```

Optional local smoke:

```bash
docker compose up -d
npm run dev
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
```
