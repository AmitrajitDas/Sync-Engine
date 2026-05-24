# SPEC-020: Production Hardening Fixes

## Goal

Close the implementation gaps left in `SPEC-015`: correct route-aware rate limiting, wire OpenTelemetry tracing, and apply the gRPC circuit breaker on actual call paths.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, section 12: production readiness.
- `docs/specs/SPEC-015.md`: original hardening scope.
- `src/gateway/plugins/rateLimiter.ts`: current `onRoute` approach.
- `src/observability/tracing.ts`: current stub.
- `src/grpc/circuitBreaker.ts`: breaker factory.

## In Scope

- Fix rate limiting for `@fastify/rate-limit` v10 (per-route config at registration).
- Verify limits: pull 200/min/user, push 60/min/user, snapshot 5/min/user; per-IP fallback pre-auth.
- Install and wire OpenTelemetry: HTTP→gRPC context propagation, span attributes `tenant.id`, `user.id`, `bucket`, `collection`, `client.id`.
- Apply circuit breaker on every RBAC client call (coordinated with `SPEC-016`).
- Standardize Pino fields: `tenant_id`, `user_id`, `request_id`, `trace_id`, `route`, `latency_ms`; never log raw JWTs.

## Out of Scope

- New endpoints.
- Dashboards / alert manager.
- Load-test suite.
- Proto definitions (owned by `SPEC-016`).

## Implementation Changes

Rate limiting:

- Replace `onRoute` hook with explicit `config.rateLimit` passed where `pull`/`push`/`snapshot` routes are registered.
- Keep Redis store when `redis` dep present; per-IP `keyGenerator` fallback before `request.user`.

Tracing (`src/observability/tracing.ts`):

- Install `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http`.
- Init SDK when `OTEL_EXPORTER_OTLP_ENDPOINT` set; import before app build.
- Add span attribute hook in request lifecycle.

Circuit breaker:

- Ensure `SPEC-016` clients call through `createGrpcCircuitBreaker`; expose breaker state to readiness check.

Logging:

- Pino serializers redacting `authorization` header and token fields; add request-context fields via hook.

## Error Handling

- Rate limit exceeded -> 429 with standard JSON shape via error handler.
- Breaker open -> 503 fast-fail; readiness reports RBAC degraded.
- Tracing exporter down -> never blocks request path (fire-and-forget).

## Test Plan

- `rateLimit.test.ts`: key is `user.sub` when authed, IP otherwise; limits applied per route.
- `logging.test.ts`: redaction of auth header/JWT.
- Breaker integration: open trips readiness to degraded.
- Tracing: span attributes present on a sampled request (mock exporter).

## Acceptance Criteria

- Route limits enforced per-user with IP fallback.
- OTel spans emitted with required attributes when endpoint configured.
- All RBAC gRPC calls breaker-wrapped.
- Logs structured, secrets redacted.
- `npm run build` passes.
- `npm run test` passes.

## Follow-Up Specs

- `SPEC-023`: Test suite consolidates these tests.
