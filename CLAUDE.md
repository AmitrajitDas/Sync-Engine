# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Scaffolding complete. Core skeleton is live: Fastify app, env validation, health route, two unit tests. All domain directories (`src/cdc`, `src/eventbus`, `src/oplog`, `src/sync`, `src/grpc`, `src/buckets`, `src/conflicts`) exist but are empty placeholders. `SYNC_SERVICE_PLAN-v2.md` is the authoritative design doc — all new implementation follows that plan.

## What this service is

Offline-first sync gateway for React Native clients. Mimics PowerSync. **One of two microservices** — companion is RBAC + Business Base Service (Spring Boot, separate repo). Sync owns the protocol and oplog; RBAC owns business data, auth, and persistence.

## Commands

```bash
npm run dev          # tsx watch src/index.ts
npm run build        # tsc
npm run start        # node dist/index.js
npm run test         # vitest run
npm run test:watch   # vitest
npm run proto:gen    # regenerate gRPC stubs from proto/
```

Run single test file:
```bash
npx vitest run tests/unit/health.test.ts
```

## TypeScript / ESM notes

- `"type": "module"` + `moduleResolution: NodeNext` — **all imports must use `.js` extension** even for `.ts` source files (e.g. `import { foo } from "./foo.js"`).
- Tests live in `tests/` (excluded from `tsc`); source in `src/`.
- `buildApp` accepts `Pick<Env, "LOG_LEVEL">` — inject only what's needed, not full env.

## Architecture

### Data flow

```
Postgres (RBAC) → Debezium → Kafka → DebeziumKafkaConsumer
                                              ↓
                                         EventBus.publish()
                                              ↓
                                        OplogConsumer → MongoDB oplog
                                                              ↓
                                              GET /sync/pull ← mobile client
```

Push path: `POST /sync/push` → sync rules validation → gRPC `RbacCheck.Check` → gRPC `BusinessProxy.ApplyWrite` (RBAC persists to Postgres + outbox) → CDC catches up async → surfaces on next pull.

### Two-database pattern

- **Postgres** (owned by RBAC): source of truth, business data, strong consistency
- **MongoDB** (owned by sync): append-only oplog only — stores `NormalizedChangeEvent` entries with `seq` + bucket tags. TTL auto-expires after 30d.

### EventBus decoupling

`EventBus` interface (`publish` / `register`) decouples CDC source from consumers. `KafkaEventBus` wraps `DebeziumKafkaConsumer` in production; `InProcessEventBus` (in-memory) used in tests. New consumers added via `eventBus.register()` with zero changes to CDC consumer.

### Bucket-based partitioning

Pull queries filter by bucket tags derived from JWT claims:
- `tenant:{tenantId}:region:{region}` — regional data (farms, plots, crops)
- `tenant:{tenantId}:user:{userId}` — user-scoped data (invoices, attachments)
- `tenant:{tenantId}:*` — tenant admin wildcard

### Sequence numbers

Monotonic `seq` from Postgres SEQUENCE (via gRPC `getNextSeq()`) — not timestamps. Redis INCR is local-dev fallback only.

### Sync rules

Defined in `src/sync/syncRules.ts` as TypeScript (not YAML/DSL). Two levels:
1. **Pull rules**: per-collection field projection + bucket filter
2. **Write rules**: allowed roles, ops, protected fields, ownership check

Sync rules = first-line performance filter. RBAC gRPC = authoritative.

### Conflict resolution

- `lastWriteWins` (field-level, per `_meta.field_timestamps`): farms, plots, crops, gdc_submissions
- `serverWins`: action_events, inspections, invoices, farm_members, attachments

Sync runs conflict pre-flight before gRPC; RBAC runs it authoritatively inside `ApplyWrite`.

### gRPC clients to RBAC

Three clients in `src/grpc/` (not yet implemented):
- `RbacCheckClient` — `Check` / `CheckBatch` for ABAC
- `BusinessProxyClient` — `ApplyWrite` (push write path)
- `AttachmentClient` — `Presign` / `GetDownloadUrl`

Circuit breaker (opossum) on all RBAC gRPC. Open after 50% failures / 10s. Never retry `PERMISSION_DENIED` or `INVALID_ARGUMENT`.

## Key env vars

All validated at startup via Zod in `src/config/env.ts`. Missing required vars throw with field-level error messages. Required:
- `MONGODB_URI`, `REDIS_URL`, `KAFKA_BROKERS`
- `JWKS_URL` — RBAC's `/.well-known/jwks.json`, cached 1h
- `JWT_ISSUER`
- `RBAC_GRPC_ADDRESS` — e.g. `rbac-service:9090`

Optional with defaults: `PORT` (3000), `LOG_LEVEL` (info), `KAFKA_CONSUMER_GROUP`, `KAFKA_CDC_TOPIC_PREFIX`, `RBAC_GRPC_TIMEOUT_MS` (2000), `OPLOG_TTL_DAYS` (30), `PULL_DEFAULT_LIMIT` (500), `PULL_MAX_LIMIT` (1000).

## Testing

Vitest + Testcontainers (real Mongo, Redis, Kafka in integration tests). Integration tests spin up containers — they are slow. Unit tests use `InProcessEventBus` and mocked gRPC stubs. Test pattern: use `app.inject()` for HTTP, pass `{ LOG_LEVEL: "silent" }` to `buildApp` to suppress log noise.

## Proto generation

`proto/` mirrors RBAC repo (recommend git submodule). Regenerate after proto changes:
```bash
npm run proto:gen
```
Output lands in `src/grpc/generated/`.

## Integration contract with RBAC

Sync consumes from RBAC; RBAC has zero inbound dependency on sync:
- JWKS endpoint for JWT verification
- Kafka topics `business.cdc.public.*` from Debezium
- gRPC: `RbacCheck`, `BusinessProxy`, `AttachmentGrpc`

JWT claims sync depends on: `sub`, `tenant_id`, `tenant_slug`, `region`, `roles[]` (RS256).

RBAC migration requirement: tables without direct `region` column (plots, crops, action_events) need generated column `region` denormalized from parent farm — required for bucket tagging.
