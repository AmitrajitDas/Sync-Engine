# Sync Engine

Offline-first sync gateway for React Native clients. PowerSync-style protocol.

## What it does

- Consumes Debezium CDC events from Kafka, normalizes them into an oplog in MongoDB.
- Exposes pull/push sync protocol over HTTP so mobile clients can sync offline data.
- Delegates authorization and persistence to RBAC over gRPC.
- Never owns business data; only owns the oplog and sync protocol.

## Setup

```bash
npm install
cp .env.example .env   # fill in required vars
```

Required env vars: `MONGODB_URI`, `REDIS_URL`, `KAFKA_BROKERS`, `JWKS_URL`, `JWT_ISSUER`, `RBAC_GRPC_ADDRESS`.

## Dev

```bash
npm run dev          # tsx watch — hot reload
npm run build        # tsc compile check
npm run start        # run compiled output
```

## Test

```bash
npm run test         # vitest run (unit tests only)
npm run test:watch   # vitest watch
```

Integration tests spin up Testcontainers (Docker required):

```bash
npx vitest run tests/integration/
```

## Local infrastructure

```bash
docker compose up -d    # MongoDB, Redis, Kafka, Zookeeper
npm run dev
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
```

## Proto generation

After changing `proto/*.proto`:

```bash
npm run proto:gen   # regenerates src/grpc/generated/
```

## Architecture

```
Postgres (RBAC) → Debezium → Kafka → DebeziumKafkaConsumer
                                              ↓
                                         EventBus.publish()
                                              ↓
                                        OplogConsumer → MongoDB oplog
                                                              ↓
                                              GET /sync/pull ← mobile client
```

Push: `POST /sync/push` → sync rules → conflict pre-flight → gRPC `RbacCheck.Check` → gRPC `BusinessProxy.ApplyWrite` → CDC catches up async → surfaces on next pull.

## Endpoints

| Method | Path                      | Auth | Description                      |
| ------ | ------------------------- | ---- | -------------------------------- |
| GET    | /health                   | No   | Liveness                         |
| GET    | /health/live              | No   | Liveness                         |
| GET    | /health/ready             | No   | Readiness (checks Mongo, Redis)  |
| GET    | /metrics                  | No   | Prometheus metrics               |
| GET    | /sync/checkpoint          | JWT  | Max seq for user buckets         |
| POST   | /sync/pull                | JWT  | Fetch oplog deltas               |
| POST   | /sync/push                | JWT  | Submit client writes             |
| GET    | /sync/snapshot            | JWT  | Full bootstrap snapshot (NDJSON) |
| GET    | /sync/schema              | JWT  | Client SQLite DDL + migrations   |
| POST   | /sync/attachments/presign | JWT  | Presign upload URL (via RBAC)    |
| GET    | /sync/attachments/:id/url | JWT  | Download URL (via RBAC)          |

## ADRs

See `docs/adr/` for architecture decision records.
