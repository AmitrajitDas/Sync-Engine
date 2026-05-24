# SPEC-023: Test Suite — Unit and Integration Coverage

## Goal

Implement the deferred test coverage for `SPEC-005` through `SPEC-022`. Every prior spec carried a Test Plan section that was skipped during implementation; this spec executes them as one consolidated workstream.

## Source References

- `docs/specs/SPEC-005.md` … `SPEC-022.md`: each spec's `## Test Plan` section is authoritative.
- `CLAUDE.md`: Vitest + Testcontainers; `app.inject()` for HTTP; `{ LOG_LEVEL: "silent" }`; `InProcessEventBus` + mocked gRPC for unit.

## In Scope

Unit tests (mocked deps, no containers):

- CDC: `postgresChangeNormalizer`, `topicResolver`, `debeziumKafkaConsumer`.
- Gateway: `authPlugin`, `bucketResolver`, `errorHandler`, `rateLimit`, `logging` redaction.
- Routes: `checkpoint`, `pull`, `push`, `snapshot`, `schema`, `attachment`, `subscribe`.
- Sync: `syncRules`, `syncRulesEngine` projection/validation.
- Conflicts: `lastWriteWins`, `serverWins`, `conflictResolver` strategy selection.
- gRPC: `rbacCheckClient`, `businessProxyClient`, `attachmentClient`, circuit breaker.
- Realtime: `subscriptionRegistry`, `redisFanout`, `subscriptionNotifier`.
- Schema coordination: rollout bucketing, policy, contiguous-migration assertion.
- Lifecycle: graceful shutdown order; readiness healthy vs failing deps.

Integration tests (Testcontainers):

- Mongo: oplog append/query, index creation + TTL, `replayDocument`, `findByClientWrite`.
- Redis: checkpoint cache fast-path, rate-limit store, pub/sub fan-out.
- Kafka: Debezium-shaped message → normalizer → oplog.
- Postgres: `PostgresSnapshotReader` ordered/bucket-filtered stream.
- Two-instance: WebSocket notify across instances via Redis.
- App-start smoke against compose infra; `/health/ready` all `ok`.

## Out of Scope

- Full load-test suite.
- Production dashboards.
- Changing implementation behavior (tests adapt to code; fix only genuine bugs found).

## Implementation Changes

- Test helpers: JWT signer for fake RS256 + JWKS mock, oplog seeding, fake `EventBus`, mock gRPC clients.
- `tests/unit/**` per module above.
- `tests/integration/**` gated behind Testcontainers; skip gracefully if Docker absent.
- CI doc: unit always; integration on demand / CI with Docker.

## Error Handling

- Genuine bugs surfaced by tests -> fix in source, note in spec follow-up, keep test asserting correct behavior.
- Flaky container tests -> explicit readiness waits, no arbitrary sleeps.

## Test Plan

- This spec *is* the test plan; success = suites implemented and green.
- Coverage target: every route, every error-mapping branch, every conflict strategy, every gRPC status mapping.

## Acceptance Criteria

- All Test Plan items from `SPEC-005`–`SPEC-022` implemented.
- `npm run test` green (unit).
- Integration suite green with Docker available.
- No implementation regressions; existing `env`/`health` tests still pass.
- `npm run build` passes.

## Follow-Up Specs

- None — closes the deferred-test debt.
