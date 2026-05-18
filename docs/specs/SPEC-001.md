# SPEC-001: Initial Project Scaffold

## Goal

Create the first buildable Sync Engine milestone: a strict TypeScript Node/Fastify project skeleton with validated environment config, a health endpoint, a test harness, and the planned top-level module boundaries.

`SYNC_SERVICE_PLAN-v2.md` remains the architecture source of truth. This spec only covers the initial scaffold needed before CDC, oplog, sync rules, auth, and gRPC work begins.

## In Scope

- Initialize the Node.js project with strict TypeScript and NodeNext module resolution.
- Add baseline npm scripts for development, build, test, start, and proto generation.
- Create the planned folder structure under `src/`, `tests/`, `proto/`, and `docs/`.
- Add a minimal Fastify app shell with `GET /health`.
- Add zod-based environment validation in `src/config/env.ts`.
- Add `.env.example` with required variables from the architecture plan.
- Add Vitest configuration and initial unit tests.
- Add placeholder docs folders for specs and ADRs.

## Out of Scope

- CDC ingestion, Debezium, Kafka consumers, and event bus implementation.
- MongoDB oplog schema, sequence generation, and oplog query logic.
- JWT/JWKS auth, tenant context, authorization, and RBAC gRPC clients.
- Pull, push, checkpoint, snapshot, schema, and attachment sync endpoints.
- Docker Compose service wiring beyond placeholders or a later spec.
- Production hardening such as metrics, tracing, circuit breakers, and graceful shutdown.

## Step-by-Step Implementation Plan

### 1. Initialize package metadata

Create `package.json` with `"type": "module"` and these scripts:

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "proto:gen": "protoc --plugin=./node_modules/.bin/protoc-gen-ts_proto --ts_proto_out=./src/grpc/generated --ts_proto_opt=outputServices=grpc-js -I ./proto ./proto/*.proto"
  }
}
```

Install runtime dependencies:

```bash
npm install fastify @fastify/cors @fastify/rate-limit @fastify/compress mongodb ioredis kafkajs zod pino dotenv @grpc/grpc-js @grpc/proto-loader jsonwebtoken jwks-rsa @sinclair/typebox
```

Install development dependencies:

```bash
npm install -D typescript @types/node @types/jsonwebtoken vitest tsx eslint prettier ts-proto testcontainers
```

### 2. Configure TypeScript

Create `tsconfig.json` using ES2022, strict mode, and NodeNext module resolution:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

Create `vitest.config.ts` for Node-based tests.

### 3. Create the planned directory structure

Create these directories, even if most contain only `.gitkeep` placeholders for this milestone:

```text
proto/
src/
src/config/
src/gateway/routes/
src/gateway/plugins/
src/gateway/schemas/
src/cdc/
src/oplog/
src/sync/
src/grpc/generated/
src/eventbus/consumers/
src/buckets/
src/conflicts/strategies/
src/utils/
tests/unit/
tests/integration/
docs/specs/
docs/adr/
```

### 4. Add validated environment config

Create `src/config/env.ts` with zod validation for:

```ts
PORT
LOG_LEVEL
MONGODB_URI
REDIS_URL
KAFKA_BROKERS
KAFKA_CONSUMER_GROUP
KAFKA_CDC_TOPIC_PREFIX
JWKS_URL
JWT_ISSUER
JWT_AUDIENCE
RBAC_GRPC_ADDRESS
RBAC_GRPC_TIMEOUT_MS
OPLOG_TTL_DAYS
PULL_DEFAULT_LIMIT
PULL_MAX_LIMIT
```

Defaults:

- `PORT=3000`
- `LOG_LEVEL=info`
- `KAFKA_CONSUMER_GROUP=sync-service`
- `KAFKA_CDC_TOPIC_PREFIX=business.cdc.public.`
- `RBAC_GRPC_TIMEOUT_MS=2000`
- `OPLOG_TTL_DAYS=30`
- `PULL_DEFAULT_LIMIT=500`
- `PULL_MAX_LIMIT=1000`

`MONGODB_URI`, `REDIS_URL`, `KAFKA_BROKERS`, `JWKS_URL`, `JWT_ISSUER`, and `RBAC_GRPC_ADDRESS` are required.

### 5. Add `.env.example`

Create `.env.example`:

```bash
PORT=3000
LOG_LEVEL=info

MONGODB_URI=mongodb://mongo:27017/sync
REDIS_URL=redis://redis:6379

KAFKA_BROKERS=kafka:9092
KAFKA_CONSUMER_GROUP=sync-service
KAFKA_CDC_TOPIC_PREFIX=business.cdc.public.

JWKS_URL=http://rbac-service:8080/.well-known/jwks.json
JWT_ISSUER=https://auth.wingsure.local

RBAC_GRPC_ADDRESS=rbac-service:9090
RBAC_GRPC_TIMEOUT_MS=2000

OPLOG_TTL_DAYS=30
PULL_DEFAULT_LIMIT=500
PULL_MAX_LIMIT=1000
```

Do not include secrets.

### 6. Add the Fastify app shell

Create a small app factory so tests can instantiate the server without binding a port:

- `src/app.ts`: exports `buildApp()`.
- `src/index.ts`: imports env, builds app, listens on `env.PORT`.
- `GET /health`: returns a simple JSON payload such as `{ "status": "ok" }`.

Register only low-risk baseline plugins in this milestone: CORS, compression, and the centralized health route. Leave auth, tenant context, rate limits, sync routes, Kafka, Mongo, Redis, and gRPC wiring for later specs.

### 7. Add initial tests

Create unit tests for:

- `GET /health` returns HTTP 200 and status `ok`.
- env parsing applies defaults when optional values are omitted.
- env parsing fails when required values are missing.

Tests should not require MongoDB, Redis, Kafka, RBAC, or Docker.

## Expected Project Tree After Completion

```text
.
├── .env.example
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── proto/
├── src/
│   ├── app.ts
│   ├── index.ts
│   ├── config/
│   │   └── env.ts
│   ├── gateway/
│   │   ├── routes/
│   │   ├── plugins/
│   │   └── schemas/
│   ├── cdc/
│   ├── oplog/
│   ├── sync/
│   ├── grpc/
│   │   └── generated/
│   ├── eventbus/
│   │   └── consumers/
│   ├── buckets/
│   ├── conflicts/
│   │   └── strategies/
│   └── utils/
├── tests/
│   ├── unit/
│   └── integration/
└── docs/
    ├── specs/
    │   └── SPEC-001.md
    └── adr/
```

## Acceptance Criteria

- `npm run build` compiles without TypeScript errors.
- `npm run test` passes without external services.
- `npm run dev` starts the Fastify service.
- `GET /health` returns HTTP 200 and `{ "status": "ok" }`.
- `.env.example` mirrors the required variables listed in this spec.
- The created folder structure matches the planned module boundaries from `SYNC_SERVICE_PLAN-v2.md`.

## Test Plan

Run:

```bash
npm run build
npm run test
```

Optional manual check:

```bash
npm run dev
curl http://localhost:3000/health
```

Expected response:

```json
{ "status": "ok" }
```

## Follow-Up Specs

- `SPEC-002`: Docker Compose and local infrastructure.
- `SPEC-003`: Oplog schema, sequence generation, and oplog service.
- `SPEC-004`: EventBus interface and in-process test bus.
- `SPEC-005`: CDC normalization and Debezium Kafka consumer.
- `SPEC-006`: Auth, tenant context, and gateway error handling.
