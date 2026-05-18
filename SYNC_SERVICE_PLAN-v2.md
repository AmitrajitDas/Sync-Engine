# Sync Service — Implementation Plan

> Production-grade Node/Fastify service. Mimics PowerSync for offline-first React Native clients.
> Consumes Postgres CDC stream from RBAC service via Debezium → Kafka, maintains oplog in MongoDB.
> Exposes pull/push/snapshot/schema/checkpoint HTTP endpoints to mobile. Push proxies to RBAC
> service over gRPC for authorization + persistence.
>
> **One of two microservices.** Companion = **RBAC + Business Base Service** (Spring Boot,
> see RBAC_BASE_SERVICE_PLAN.md) which owns Postgres + business logic + JWT issuance.
> Both services developed independently, integrated at end. Integration contract in section 14.

---

## 1. Service responsibilities

This service owns:

- Sync protocol: pull (delta retrieval), push (write ingestion), checkpoint, snapshot, schema endpoints
- Oplog: append-only change log in MongoDB, queryable by sequence number + bucket
- CDC consumption: Kafka topics published by Debezium watching RBAC's Postgres
- Bucket-based partitioning: tenant + region scoping for pull filtering
- Conflict resolution: last-write-wins (field-level) + server-wins per-collection
- Sync rules engine: per-collection pull filters, write validation, field projection
- Attachment URL proxying: forwards mobile presign / download requests to RBAC over gRPC
- Resume token persistence: Kafka consumer offset

This service does NOT own:

- Business data (Postgres in RBAC service)
- Authorization decisions (calls RBAC `RbacCheck.Check` over gRPC)
- Authentication (verifies JWTs issued by RBAC via JWKS)
- Attachment storage (MinIO, accessed via RBAC presign)

Stateless gateway + change log. Postgres = source of truth. Mongo = oplog only.

---

## 2. Why two databases

Pattern: **Postgres = source of truth, Mongo = oplog**.

- Postgres owns business + RBAC. Strong consistency, transactions, joins, RLS.
- Mongo holds append-only change events from Postgres CDC. Document model fits variable-shape events. TTL indexes auto-expire old entries. Query pattern `seq > checkpoint AND bucket IN buckets` Mongo handles fine.

Polyglot persistence intentional. ADR documents tradeoff.

---

## 3. Tech stack

| Layer     | Tech                     | Reason                                                |
| --------- | ------------------------ | ----------------------------------------------------- |
| Runtime   | Node.js 20+              | Async I/O, ecosystem fits sync gateway                |
| Language  | TypeScript strict        | Type safety on protocol contracts                     |
| Framework | Fastify v5               | Fast, schema-driven, JSON Schema native               |
| Oplog     | MongoDB 7                | Append-only changes, TTL auto-expire, doc-shaped      |
| Cache     | Redis 7                  | Bucket checkpoint cache, JWKS cache, rate limit       |
| Broker    | Kafka 3.7                | CDC consumer (from RBAC's Debezium), shared cluster   |
| Auth      | JWT verify via JWKS      | Issued by RBAC, RS256, JWKS cached 1h                 |
| gRPC      | @grpc/grpc-js + ts-proto | Calls RBAC RbacCheck + BusinessProxy + AttachmentGrpc |
| Testing   | Vitest + Testcontainers  | Real Mongo + Redis + Kafka in tests                   |
| Container | Docker Compose           | Local dev stack                                       |
| Lint      | ESLint + Prettier        |                                                       |

---

## 4. Project structure

```
sync-service/
├── proto/                                  # gRPC contracts (mirror of RBAC repo)
│   ├── rbac_check.proto
│   ├── business_proxy.proto
│   └── attachment.proto
│
├── src/
│   ├── index.ts                            # Entry: Fastify + Kafka consumer + EventBus wiring
│   ├── config/
│   │   ├── env.ts                          # zod-validated env vars
│   │   ├── mongo.ts                        # MongoClient singleton
│   │   ├── redis.ts                        # ioredis singleton
│   │   ├── kafka.ts                        # KafkaJS client
│   │   └── grpc.ts                         # RBAC gRPC client setup
│   │
│   ├── eventbus/                           # Decouples CDC source from oplog writer
│   │   ├── EventBus.ts                     # interface { publish, register }
│   │   ├── KafkaEventBus.ts                # production: KafkaJS consumer fans out to consumers
│   │   ├── InProcessEventBus.ts            # tests / local
│   │   └── consumers/
│   │       └── OplogConsumer.ts            # writes oplog entries to Mongo
│   │
│   ├── cdc/
│   │   ├── DebeziumKafkaConsumer.ts        # consumes business.cdc.public.* topics
│   │   ├── postgresChangeNormalizer.ts     # Debezium envelope → NormalizedChangeEvent
│   │   └── topicResolver.ts                # topic name → collection name
│   │
│   ├── oplog/
│   │   ├── oplogService.ts                 # append, query, replay
│   │   ├── oplogSchema.ts                  # types + Mongo indexes
│   │   └── sequenceGenerator.ts            # Postgres SEQUENCE via gRPC, OR Redis INCR fallback
│   │
│   ├── sync/
│   │   ├── syncRules.ts                    # collection rules: filter, projection, write rules
│   │   ├── syncRulesEngine.ts              # resolveDataForUser, validateWrite
│   │   └── clientSchema.ts                 # versioned SQLite DDL for /sync/schema
│   │
│   ├── gateway/
│   │   ├── routes/
│   │   │   ├── pull.ts                     # POST /sync/pull
│   │   │   ├── push.ts                     # POST /sync/push (proxies to RBAC gRPC)
│   │   │   ├── checkpoint.ts               # GET /sync/checkpoint
│   │   │   ├── snapshot.ts                 # GET /sync/snapshot (large-bucket bootstrap)
│   │   │   ├── schema.ts                   # GET /sync/schema?version=N
│   │   │   └── attachment.ts               # GET/POST /sync/attachments/* (proxies)
│   │   ├── schemas/
│   │   │   ├── pullSchema.ts               # JSON Schema (typebox)
│   │   │   ├── pushSchema.ts
│   │   │   ├── checkpointSchema.ts
│   │   │   └── snapshotSchema.ts
│   │   └── plugins/
│   │       ├── auth.ts                     # JWKS-based JWT verify
│   │       ├── rateLimit.ts                # per-user, per-IP buckets
│   │       ├── tenantContext.ts            # extracts tenant_id, region, buckets from JWT
│   │       └── errorHandler.ts             # centralized error mapping
│   │
│   ├── buckets/
│   │   ├── bucketResolver.ts               # JWT claims → bucket tags
│   │   └── bucketTypes.ts
│   │
│   ├── conflicts/
│   │   ├── conflictResolver.ts
│   │   ├── strategies/
│   │   │   ├── lastWriteWins.ts
│   │   │   └── serverWins.ts
│   │   └── conflictTypes.ts
│   │
│   ├── grpc/
│   │   ├── RbacCheckClient.ts              # wraps RbacCheck.Check + CheckBatch
│   │   ├── BusinessProxyClient.ts          # wraps BusinessProxy.ApplyWrite
│   │   ├── AttachmentClient.ts             # wraps AttachmentGrpc
│   │   └── generated/                      # ts-proto output
│   │
│   └── utils/
│       ├── logger.ts                        # Pino
│       ├── clock.ts
│       └── shutdown.ts                      # graceful shutdown helpers
│
├── tests/
│   ├── unit/
│   │   ├── postgresChangeNormalizer.test.ts
│   │   ├── bucketResolver.test.ts
│   │   ├── conflictResolver.test.ts
│   │   ├── oplogService.test.ts
│   │   ├── syncRules.test.ts
│   │   └── eventBus.test.ts
│   └── integration/
│       ├── pull.test.ts
│       ├── push.test.ts
│       ├── snapshot.test.ts
│       ├── cdc.test.ts                     # Debezium → Kafka → oplog end-to-end
│       └── grpc.test.ts                    # uses RBAC stub
│
├── docker-compose.yml                      # Mongo, Redis, Kafka, Zookeeper, Debezium, Kafka UI
├── debezium/                               # connector config (mirrors RBAC's, read-only ref)
├── .env.example
├── tsconfig.json
├── package.json
├── vitest.config.ts
├── docs/
│   ├── ARCHITECTURE.md
│   ├── INTEGRATION_WITH_RBAC.md
│   └── adr/
│       ├── 001-postgres-source-mongo-oplog.md
│       ├── 002-debezium-cdc-vs-app-dual-write.md
│       ├── 003-eventbus-interface.md
│       ├── 004-kafka-only-broker.md
│       ├── 005-grpc-to-rbac-vs-http.md
│       ├── 006-field-level-lww.md
│       ├── 007-snapshot-vs-replay.md
│       └── 008-resume-token-persistence.md
└── README.md
```

---

## 5. Phase 1: Project scaffolding & infrastructure

### 5.1 Initialize

```bash
mkdir sync-service && cd sync-service
npm init -y
```

Install:

```bash
npm install fastify @fastify/jwt @fastify/cors @fastify/rate-limit @fastify/compress \
            mongodb ioredis kafkajs zod pino dotenv \
            @grpc/grpc-js @grpc/proto-loader jsonwebtoken jwks-rsa \
            @sinclair/typebox
npm install -D typescript @types/node @types/jsonwebtoken vitest tsx \
               eslint prettier ts-proto testcontainers
```

### 5.2 TypeScript

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

### 5.3 Docker Compose

Includes:

- **MongoDB 7** single node — oplog only, no replica set needed (we don't watch Mongo, we watch Postgres CDC).
- **Redis 7** — cache + rate limit.
- **Kafka 3.7 + Zookeeper** — shared broker with RBAC service.
- **Kafka UI (Provectus)** — for inspection.
- **Debezium Connect** — runs RBAC's connector. In dev compose all run together. In prod owned by RBAC team.
- **MinIO** — referenced for attachment proxy testing. Sync calls RBAC presign which targets MinIO.

### 5.4 Environment config

`src/config/env.ts` — zod validation:

```typescript
const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.string().default("info"),

  MONGODB_URI: z.string().url(),
  REDIS_URL: z.string().url(),

  KAFKA_BROKERS: z.string(),
  KAFKA_CONSUMER_GROUP: z.string().default("sync-service"),
  KAFKA_CDC_TOPIC_PREFIX: z.string().default("business.cdc.public."),

  JWKS_URL: z.string().url(),
  JWT_ISSUER: z.string(),
  JWT_AUDIENCE: z.string().optional(),

  RBAC_GRPC_ADDRESS: z.string(),
  RBAC_GRPC_TIMEOUT_MS: z.coerce.number().default(2000),

  OPLOG_TTL_DAYS: z.coerce.number().default(30),
  PULL_DEFAULT_LIMIT: z.coerce.number().default(500),
  PULL_MAX_LIMIT: z.coerce.number().default(1000),
});
```

### 5.5 Entry point

`src/index.ts`:

- Init Fastify with Pino.
- Register CORS, rate limit, compression, auth (JWKS), tenant context, error handler, route plugins.
- Connect Mongo, Redis, Kafka.
- Init gRPC clients to RBAC.
- Wire EventBus → OplogConsumer.
- Start CDC consumer (Kafka).
- Listen on port.
- Graceful shutdown: stop accepting → close Kafka consumer → close Fastify → close DB clients.

Scripts:

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

---

## 6. Phase 2: Oplog & change source

### 6.1 Oplog schema

`src/oplog/oplogSchema.ts`:

```typescript
interface OplogEntry {
  _id: ObjectId;
  seq: number; // monotonic, from Postgres SEQUENCE
  timestamp: Date;
  collection: string; // farms | plots | crops | action_events | ...
  docId: string; // Postgres row UUID as string
  operation: "insert" | "update" | "delete";
  delta: Record<string, any> | null; // changed fields; null for delete
  fullDoc?: Record<string, any>; // full snapshot on insert
  bucket: string; // "tenant:abc-123:region:karnataka"
  tenantId: string;
  origin: "server" | "client"; // "client" if from sync push
  clientId?: string;
  clientSeq?: number;
  // CDC metadata
  cdcSourceTopic?: string;
  cdcLsn?: string;
  cdcOffset?: string;
}
```

Mongo indexes:

```typescript
db.oplog.createIndex({ seq: 1, bucket: 1 });
db.oplog.createIndex({ timestamp: 1 }, { expireAfterSeconds: 30 * 86400 });
db.oplog.createIndex({ collection: 1, docId: 1, seq: -1 });
db.oplog.createIndex({ tenantId: 1, seq: -1 });
db.oplog.createIndex({ clientId: 1, clientSeq: 1 }, { sparse: true });
```

### 6.2 Sequence generator

Two strategies, chosen by config:

- **Postgres SEQUENCE** (recommended): RBAC exposes gRPC `getNextSeq()`, OR sync has read-only Postgres connection calling `nextval('oplog_seq')`. Cluster-safe.
- **Redis INCR fallback**: `INCR sync:seq` on single Redis. Local dev only.

ADR documents tradeoff.

### 6.3 Oplog service

`src/oplog/oplogService.ts`:

```typescript
appendToOplog(entry: Omit<OplogEntry, "_id" | "seq">): Promise<OplogEntry>
getEntriesAfter(seq: number, buckets: string[], limit?: number): Promise<OplogEntry[]>
getLatestSeq(buckets?: string[]): Promise<number>
replayFromSeq(seq: number, buckets: string[]): AsyncIterator<OplogEntry>
replayDocument(collection: string, docId: string): Promise<OplogEntry[]>
replayFromTimestamp(from: Date, buckets?: string[]): AsyncIterator<OplogEntry>
findByClientWrite(clientId: string, clientSeq: number): Promise<OplogEntry | null>
```

Stream-based replay (cursors) so large replays don't OOM.

### 6.4 Postgres change normalizer

Debezium emits:

```json
{
  "payload": {
    "before": null,
    "after": { "id": "...", "tenant_id": "...", "name": "...", ... },
    "source": { "lsn": ..., "table": "farms", "ts_ms": ... },
    "op": "c"
  }
}
```

Normalizer:

- `op: "c"` → `insert`, `delta = after`, `fullDoc = after`
- `op: "u"` → `update`, `delta = diff(before, after)`, `fullDoc = after`
- `op: "d"` → `delete`, `delta = null`
- `op: "r"` → snapshot read, treat as insert

Bucket from `after.tenant_id` + `after.region`. For tables without direct region (plots, crops, action_events): RBAC migration adds generated column `region` denormalized from parent farm. Documented as integration contract.

### 6.5 Debezium Kafka consumer

```typescript
class DebeziumKafkaConsumer {
  constructor(
    private kafka: Kafka,
    private eventBus: EventBus,
  ) {}

  async start() {
    const consumer = this.kafka.consumer({ groupId: env.KAFKA_CONSUMER_GROUP });
    await consumer.subscribe({
      topics: [new RegExp(`^${env.KAFKA_CDC_TOPIC_PREFIX}.*$`)],
      fromBeginning: false,
    });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const envelope = JSON.parse(message.value!.toString());
        const collection = topicResolver.resolve(topic);
        const event = postgresChangeNormalizer(envelope, collection, message);
        await this.eventBus.publish(event);
      },
    });
  }
}
```

Resume = Kafka consumer offset, stored automatically by Kafka. Restart → resume from last committed offset → no events lost.

### 6.6 Unit tests

- `postgresChangeNormalizer.test.ts`: c/u/d ops, bucket extraction, delta diff for updates.
- `oplogService.test.ts`: append + query + replay (cursor-based).
- `eventBus.test.ts`: publish fans out to consumers, one failing doesn't block others.

---

## 7. Phase 2b: Event bus

### 7.1 Interface

```typescript
export interface NormalizedChangeEvent {
  collection: string;
  docId: string;
  operation: "insert" | "update" | "delete";
  delta: Record<string, any> | null;
  fullDoc?: Record<string, any>;
  bucket: string;
  tenantId: string;
  timestamp: Date;
  origin: "server" | "client";
  clientId?: string;
  clientSeq?: number;
  cdcSourceTopic?: string;
  cdcLsn?: string;
  cdcOffset?: string;
}

export interface EventBusConsumer {
  name: string;
  handle(event: NormalizedChangeEvent): Promise<void>;
}

export interface EventBus {
  publish(event: NormalizedChangeEvent): Promise<void>;
  register(consumer: EventBusConsumer): void;
}
```

### 7.2 KafkaEventBus (production)

`DebeziumKafkaConsumer` IS the publisher. Normalizes Debezium envelopes → `NormalizedChangeEvent` → `eventBus.publish()` → fans out to in-process consumers.

Broker = Kafka (durable, replayable). Fan-out within service = in-process. Future microservices wanting same events = subscribe to Kafka topics directly.

### 7.3 InProcessEventBus

Pure in-memory pub-sub for tests. `publish()` calls all consumers via `Promise.allSettled`.

### 7.4 OplogConsumer

```typescript
class OplogConsumer implements EventBusConsumer {
  name = "oplog";
  constructor(
    private oplog: OplogService,
    private redis: Redis,
    private seq: SequenceGenerator,
  ) {}

  async handle(event: NormalizedChangeEvent) {
    const seqNum = await this.seq.getNextSeq();
    const entry: OplogEntry = { ...event, seq: seqNum, _id: new ObjectId() };
    await this.oplog.appendToOplog(entry);
    await this.redis.set(`sync:checkpoint:${event.bucket}`, seqNum.toString());
  }
}
```

Future consumers added by `eventBus.register()` — zero changes to CDC consumer.

---

## 8. Phase 3: Sync gateway API

### 8.1 Auth plugin

`jwks-rsa` fetches RBAC's JWKS, cached 1h, ETag-aware. `preHandler` on `/sync/*` verifies signature + `iss` + `exp`. Decodes claims:

```typescript
interface SyncUser {
  sub: string;
  tenantId: string;
  tenantSlug: string;
  region: string;
  roles: string[];
  jti: string;
}
```

Attached to `request.user`.

### 8.2 Tenant context plugin

After auth, resolves buckets via `bucketResolver`, attaches `request.buckets: string[]`.

### 8.3 Error handler

Maps:

- `AuthError` → 401
- `ValidationError` → 400
- `ConflictError` → 409 with `serverVersion`
- gRPC `PERMISSION_DENIED` → 403
- gRPC `UNAVAILABLE` → 503
- default → 500

### 8.4 Pull endpoint

`POST /sync/pull`:

```json
{ "checkpoint": 0, "limit": 500, "collections": ["farms", "plots"] }
```

Logic:

1. Resolve buckets from JWT.
2. Fast path: read `sync:checkpoint:<bucket>` from Redis. If user checkpoint ≥ all bucket maxes → return empty.
3. Query oplog: `seq > checkpoint AND bucket IN buckets AND collection IN collections`. Order `seq ASC`, limit ≤ `PULL_MAX_LIMIT`.
4. Apply field projection from `syncRules`.
5. Return `{ entries, checkpoint, hasMore }`. Client polls until `hasMore=false`.

### 8.5 Push endpoint

`POST /sync/push`:

```json
{
  "clientId": "device-abc-123",
  "writes": [
    {
      "collection": "farms",
      "docId": "farm-456",
      "operation": "insert",
      "payload": { ... },
      "clientTimestamp": "2026-05-09T10:30:00Z",
      "baseSeq": 0,
      "clientSeq": 42,
      "idempotencyKey": "uuid-..."
    }
  ]
}
```

Per write:

1. Local sync rules validation (collection allowed, op allowed, ownership, strip protected fields).
2. Optional `RbacCheck.Check` gRPC for ABAC. Cached 60s in Redis per `(user, resource, action, ctx_hash)`.
3. `BusinessProxy.ApplyWrite` gRPC with `idempotencyKey`, `clientId`, `clientSeq`, `baseSeq`, payload.
4. RBAC validates + persists Postgres + outbox event in same tx.
5. Return `{status, serverSeq?, serverVersion?}`.
6. CDC catches up async: Debezium → Kafka → OplogConsumer with `origin: "client"`. Next pull surfaces it.

Optional optimization: poll `oplogService.findByClientWrite(clientId, clientSeq)` up to 500ms after `applyWrite` → return `serverSeq` immediately if found.

Response:

```json
{
  "results": [
    { "docId": "farm-456", "status": "applied", "serverSeq": 1250 },
    { "docId": "claim-789", "status": "conflict", "serverVersion": {...} }
  ],
  "checkpoint": 1250
}
```

### 8.6 Checkpoint endpoint

`GET /sync/checkpoint`:

```json
{
  "checkpoint": 1250,
  "buckets": ["tenant:abc-123:region:karnataka", "tenant:abc-123:user:user-456"]
}
```

Reads max seq from Redis cache → fallback oplog. Lightweight "anything new" probe.

### 8.7 Snapshot endpoint

`GET /sync/snapshot?bucket=...&collections=farms,plots`:

For client checkpoint=0 + bucket too large for oplog backfill (oplog TTL=30d).

1. Authz per collection via gRPC `Check`.
2. Sync has read-only Postgres connection (read replica). `SELECT * FROM <collection> WHERE tenant_id=? AND region=? ORDER BY id`.
3. Stream NDJSON. Client writes directly to local SQLite.
4. Return `{ snapshotSeq }` so client knows where to resume oplog.

Tradeoff: sync needs Postgres read replica access. Documented in ADR.

### 8.8 Schema endpoint

`GET /sync/schema?version=N`:

```json
{
  "version": 7,
  "ddl": ["CREATE TABLE farms (...)"],
  "migrations": { "6_to_7": ["ALTER TABLE farms ADD COLUMN ..."] }
}
```

Client reads local schema version, fetches diff, applies migrations. Schema in `src/sync/clientSchema.ts`, versioned in git.

### 8.9 Attachment proxy

```
POST /sync/attachments/presign   { parentType, parentId, contentType, sizeBytes }
GET  /sync/attachments/{id}/url  → presigned download URL
```

Forwards to RBAC `AttachmentGrpc.Presign` / `GetDownloadUrl` with user JWT in metadata.

Note: MinIO finalize callback (`POST /api/v1/attachments/{id}/finalize`) goes mobile → RBAC HTTP directly, not through sync.

### 8.10 Schemas

JSON Schema (TypeBox) for all bodies. Fastify validates inbound, serializes outbound.

### 8.11 Integration tests

- `pull.test.ts` — seed oplog, verify pull filters per JWT.
- `push.test.ts` — push triggers gRPC ApplyWrite (mock), CDC echo (Testcontainers Debezium) lands in oplog.
- `snapshot.test.ts` — checkpoint=0 client gets full state.
- `cdc.test.ts` — end-to-end: insert in Postgres → Debezium → Kafka → oplog → pull surfaces.

---

## 9. Phase 3b: Sync rules engine

### 9.1 Sync rules config

```typescript
export interface CollectionSyncRule {
  filter: (params: BucketParams) => Record<string, any>;
  fields?: string[];
}

export interface BucketDefinition {
  parameters: (user: SyncUser) => BucketParams;
  collections: Record<string, CollectionSyncRule>;
}

export interface WriteRule {
  allowedRoles: string[];
  allowedOps: ("insert" | "update" | "delete")[];
  protectedFields: string[];
  ownershipCheck: (write: WriteRequest, user: SyncUser) => boolean;
}

export const syncRules: SyncRules = {
  buckets: {
    by_region: {
      parameters: (u) => ({ tenantId: u.tenantId, region: u.region }),
      collections: {
        farms: {
          filter: ({ tenantId, region }) => ({ tenant_id: tenantId, region }),
          fields: [
            "id",
            "tenant_id",
            "name",
            "region",
            "centroid",
            "metadata",
            "updated_at",
          ],
        },
        plots: { filter: (p) => ({ tenant_id: p.tenantId, region: p.region }) },
        crops: { filter: (p) => ({ tenant_id: p.tenantId, region: p.region }) },
        action_events: {
          filter: (p) => ({ tenant_id: p.tenantId, region: p.region }),
        },
        inspections: {
          filter: (p) => ({ tenant_id: p.tenantId, region: p.region }),
        },
        gdc_submissions: {
          filter: (p) => ({ tenant_id: p.tenantId, region: p.region }),
        },
      },
    },
    by_user: {
      parameters: (u) => ({ tenantId: u.tenantId, userId: u.sub }),
      collections: {
        invoices: {
          filter: ({ tenantId, userId }) => ({
            tenant_id: tenantId,
            user_id: userId,
          }),
        },
        farm_members: {
          filter: ({ tenantId, userId }) => ({
            tenant_id: tenantId,
            user_id: userId,
          }),
        },
        attachments: {
          filter: ({ tenantId, userId }) => ({
            tenant_id: tenantId,
            uploaded_by: userId,
          }),
        },
      },
    },
  },
  writeRules: {
    farms: {
      allowedRoles: ["field_agent", "tenant_admin"],
      allowedOps: ["insert", "update"],
      protectedFields: ["tenant_id", "created_at"],
      ownershipCheck: (w, u) => w.payload.region === u.region,
    },
    plots: {
      allowedRoles: ["field_agent", "tenant_admin"],
      allowedOps: ["insert", "update", "delete"],
      protectedFields: ["tenant_id"],
      ownershipCheck: () => true,
    },
    crops: {
      allowedRoles: ["field_agent", "tenant_admin"],
      allowedOps: ["insert", "update", "delete"],
      protectedFields: ["tenant_id"],
      ownershipCheck: () => true,
    },
    action_events: {
      allowedRoles: ["field_agent", "tenant_admin"],
      allowedOps: ["insert"],
      protectedFields: ["tenant_id", "created_at"],
      ownershipCheck: (w, u) => w.payload.performed_by === u.sub,
    },
    inspections: {
      allowedRoles: ["field_agent", "tenant_admin"],
      allowedOps: ["insert", "update"],
      protectedFields: ["tenant_id", "created_at"],
      ownershipCheck: (w, u) => w.payload.performed_by === u.sub,
    },
    invoices: {
      allowedRoles: ["field_agent", "tenant_admin"],
      allowedOps: ["insert"],
      protectedFields: ["tenant_id", "status", "approved_at"],
      ownershipCheck: (w, u) => w.payload.user_id === u.sub,
    },
    gdc_submissions: {
      allowedRoles: ["field_agent", "tenant_admin"],
      allowedOps: ["insert", "update"],
      protectedFields: ["tenant_id"],
      ownershipCheck: (w, u) => w.payload.submitted_by === u.sub,
    },
  },
};
```

### 9.2 Engine

```typescript
resolveDataForUser(user: SyncUser, checkpoint: number, limit: number, collections?: string[]): Promise<OplogEntry[]>
validateWrite(write: WriteRequest, user: SyncUser): CleanedWrite | ValidationError
projectFields(entry: OplogEntry): OplogEntry
```

Sync rules = first-line filter for performance. RBAC service is authoritative for permission decisions.

### 9.3 Unit tests

- Bucket filter correctness per role/region.
- Write validation: role, op, ownership, protected field stripping.
- Projection: server-only fields not in pull.

---

## 10. Phase 4: Bucket / partition system

### 10.1 Bucket types

```typescript
export type BucketTag = string;
// "tenant:<tenantId>:region:<region>" | "tenant:<tenantId>:user:<userId>" | "tenant:<tenantId>:*"
```

### 10.2 Bucket resolver

```typescript
export function resolveBuckets(user: SyncUser): BucketTag[] {
  const buckets: BucketTag[] = [];
  if (user.region)
    buckets.push(`tenant:${user.tenantId}:region:${user.region}`);
  buckets.push(`tenant:${user.tenantId}:user:${user.sub}`);
  if (user.roles.includes("tenant_admin")) {
    buckets.push(`tenant:${user.tenantId}:*`);
  }
  return buckets;
}
```

Pull query handles wildcards: `tenant:<id>:*` matches any `tenant:<id>:region:<x>` via Mongo regex on bucket field.

---

## 11. Phase 5: Conflict resolution

### 11.1 Types

```typescript
interface ConflictContext {
  collection: string;
  docId: string;
  clientPayload: Record<string, any>;
  clientTimestamp: string;
  baseSeq: number;
  serverEntries: OplogEntry[];
}

type ConflictResult =
  | { resolution: "client_wins"; mergedPayload: Record<string, any> }
  | { resolution: "server_wins"; serverVersion: Record<string, any> }
  | { resolution: "merged"; mergedPayload: Record<string, any> };
```

### 11.2 LWW (field-level)

Compare per-field timestamps. Each row has `updated_at` + optional `_meta.field_timestamps` JSONB. Most-recent wins per field. Result = merged payload sent to RBAC `ApplyWrite`.

### 11.3 Server-wins

For protected collections (inspections after approval, ml_inferences). Server state always wins. Client must re-merge.

### 11.4 Strategy map

```typescript
const strategyMap = {
  farms: lastWriteWins,
  plots: lastWriteWins,
  crops: lastWriteWins,
  action_events: serverWins,
  inspections: serverWins,
  invoices: serverWins,
  gdc_submissions: lastWriteWins,
  farm_members: serverWins,
  attachments: serverWins,
};
```

### 11.5 Where conflict resolution runs

- Sync service pre-flight: cheap, avoids gRPC roundtrip on definite conflicts.
- RBAC service inside `ApplyWrite`: defense-in-depth, authoritative.

Both run. Sync = optimization. RBAC = source of truth.

### 11.6 Unit tests

- LWW overlapping fields → newest wins per field.
- LWW non-overlapping fields → both survive.
- Server-wins returns server snapshot unchanged.

---

## 12. Phase 6: Hardening & production readiness

### 12.1 Rate limiting

`@fastify/rate-limit` with Redis store:

- Pull: 200/min/user
- Push: 60/min/user
- Snapshot: 5/min/user (heavy)
- Per-IP fallback for unauth paths.

### 12.2 Compression

`@fastify/compress` gzip + brotli. Pull deltas large.

### 12.3 Health checks

```
GET /health/live   → 200 if process up
GET /health/ready  → 200 only if Mongo + Redis + Kafka consumer + RBAC gRPC reachable
```

### 12.4 Metrics

Prometheus via `fastify-metrics`:

- Pull/push/snapshot latency p50/p95/p99
- Oplog query rows scanned
- CDC consumer lag
- Conflict rate per collection
- gRPC RPC duration
- Bucket distribution (hot buckets)

### 12.5 Tracing

OpenTelemetry — propagate trace context mobile → sync → gRPC → RBAC. Span attributes: `tenant.id`, `user.id`, `bucket`, `collection`, `client.id`.

### 12.6 Graceful shutdown

On SIGTERM/SIGINT:

1. Stop accepting HTTP (Fastify `close()`).
2. Stop Kafka consumer (commit offsets).
3. Wait in-flight gRPC max 10s.
4. Close Mongo, Redis, Kafka.
5. Exit.

### 12.7 Backpressure

Kafka `eachMessage` sequential per partition. Slow oplog write = broker buffers. Cumulative lag > threshold → alert. Mongo write batch: up to 100 events or 200ms whichever first.

### 12.8 Resilience

- Circuit breaker on RBAC gRPC (opossum). Open after 50% failures over 10s. Half-open after 30s.
- Retry exponential backoff + jitter for `UNAVAILABLE` only. Never retry `PERMISSION_DENIED` / `INVALID_ARGUMENT`.
- Fallback if RBAC down: pull works (oplog local). Push fails 503, client retries on recovery.

### 12.9 Logging

Pino structured JSON. Required: `tenant_id`, `user_id`, `request_id`, `trace_id`, `route`, `latency_ms`. INFO sampled, WARN+ all.

---

## 13. Implementation order

1. **Phase 1** — scaffold, Compose, env, entry point. Verify connect Mongo + Redis + Kafka.
2. **Phase 2.1–2.3** — oplog schema, sequence generator, oplog service incl. replay. Unit tests.
3. **Phase 2b** — EventBus interface + InProcessEventBus + OplogConsumer. Unit tests.
4. **Phase 2.4–2.6** — postgresChangeNormalizer + DebeziumKafkaConsumer (KafkaEventBus wraps). Test with Testcontainers Debezium.
5. **Phase 3.1–3.3** — auth (JWKS), tenantContext, errorHandler.
6. **Phase 3.6** — checkpoint endpoint. Smallest, validates pipeline.
7. **Phase 3b** — sync rules + engine.
8. **Phase 4** — bucket resolver. Wire into engine.
9. **Phase 3.4** — pull endpoint. Integration tests.
10. **Phase 5** — conflict resolution.
11. **Phase 3.5** — push endpoint (gRPC client). Integration tests with stub RBAC.
12. **Phase 3.7** — snapshot endpoint.
13. **Phase 3.8** — schema endpoint.
14. **Phase 3.9** — attachment proxy.
15. **Phase 6** — hardening, metrics, tracing, README.

---

## 14. Integration with RBAC + Business Base Service

This service runs independently. RBAC service (separate repo, `RBAC_BASE_SERVICE_PLAN.md`) developed in parallel. Both integrate at end.

### 14.1 What this service consumes from RBAC

1. **JWKS** — `GET /.well-known/jwks.json`. Sync verifies all client JWTs. Cached 1h.
2. **Kafka topics** — `business.cdc.public.*` published by Debezium watching RBAC's Postgres. Sync's `DebeziumKafkaConsumer` subscribes.
3. **gRPC `RbacCheck.Check`** — sync calls before push for ABAC.
4. **gRPC `BusinessProxy.ApplyWrite`** — sync push forwards client writes.
5. **gRPC `AttachmentGrpc.Presign`** + `GetDownloadUrl` — attachment URL proxy.

### 14.2 What this service exposes to RBAC

Nothing. RBAC has no inbound dependency on sync.

### 14.3 Shared artifacts

- **`proto/`** — gRPC contracts mirrored from RBAC repo. Versioned `wingsure.rbac.v1`. Recommend git submodule.
- **JWT format** — RS256 with claims `sub`, `tenant_id`, `tenant_slug`, `region`, `roles[]`, `exp`, `iat`, `jti`. Defined by RBAC.
- **Bucket convention** — `tenant:{tenantId}:region:{region}` and `tenant:{tenantId}:user:{userId}`. Sync derives from JWT claims.

### 14.4 Integration phase (after both services stable)

1. Generate gRPC client stubs from `proto/` into sync.
2. Configure `RBAC_GRPC_ADDRESS`, `JWKS_URL`, `JWT_ISSUER` env vars.
3. Confirm Kafka topic `business.cdc.public.*` populated by RBAC's Debezium.
4. End-to-end test: mobile login (RBAC) → JWT → mobile creates farm offline → sync push → gRPC ApplyWrite → Postgres + outbox → Debezium → Kafka CDC → sync OplogConsumer → second mobile pulls → sees farm.
5. Load test with k6 (5000 concurrent pull, 500 RPS push).
6. Failure modes documented:
   - RBAC down → push 503, pull continues from oplog
   - Kafka down → CDC lag, oplog stops growing, replay on recovery
   - Debezium down → same as Kafka
   - Mongo down → pull + push fail
   - Postgres down → push fails (RBAC can't persist), pull continues
   - Sync down → mobile offline-only, app uses local SQLite

### 14.5 Failure isolation

Sync degradation does not affect tenant admin web, command endpoints, or RBAC platform ops. Only mobile sync flows degrade.

### 14.6 Operational ownership boundary

In production:

- **RBAC team owns**: Postgres, Debezium connector + JSON, Kafka topic creation/ACLs, MinIO, gRPC server.
- **Sync team owns**: Mongo, Fastify service, Kafka consumer offsets, JWKS cache, gRPC client.

Shared with RBAC: proto contracts (versioned, breaking changes coordinated), bucket conventions, JWT claims structure. Shared with NotifyHub only if offline inbox is added: in-app projection event schema and client collection versioning.

### 14.7 Optional interaction with NotifyHub

Sync is not in the notification delivery path. It should not call NotifyHub when applying normal offline writes, and it should not store provider delivery state in the business oplog. Notifications are triggered by RBAC domain events after RBAC persists the source-of-truth write.

Supported integration shapes:

1. **Direct mobile inbox, recommended first:** mobile calls NotifyHub inbox APIs with the same RBAC JWT used for Sync. NotifyHub verifies JWKS and enforces `sub`/`tenant_id` access.
2. **Offline inbox projection, optional later:** NotifyHub emits `notifyhub.inapp.created` and `notifyhub.inapp.read` events. Sync consumes only those lightweight in-app events into a separate `notifications` client collection if true offline inbox is required.

Boundary rules:

- Sync consumes RBAC `business.cdc.public.*` for business data, not NotifyHub delivery topics.
- Sync may consume NotifyHub in-app projection topics only if the product requires offline notification inbox.
- Push/email/SMS delivery logs remain in NotifyHub and are queried through NotifyHub APIs or analytics projections.
- Trace headers should flow mobile → Sync → RBAC → Kafka → NotifyHub so a business write can be correlated with resulting notifications.

---

## 15. Configuration

```bash
# .env.example
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

---

## 16. ADRs to write

In `docs/adr/`:

1. Postgres source of truth, Mongo for oplog only
2. Debezium CDC over app-level dual-write
3. EventBus interface — KafkaEventBus production, InProcessEventBus tests
4. Kafka-only broker (vs Kafka + RabbitMQ split)
5. gRPC to RBAC vs HTTP/REST
6. Field-level LWW vs document-level LWW vs CRDTs
7. Snapshot endpoint vs pure oplog replay for new clients
8. Resume token persistence: Kafka consumer offset is sufficient

---

## 17. Key design decisions summary

- **Sequence numbers over timestamps** — total order, no clock skew. Source = Postgres SEQUENCE.
- **Postgres = source of truth, Mongo = oplog** — strong consistency for business state, append-only doc store for change events.
- **Push proxies to RBAC over gRPC** — sync does not own validation or persistence. Clean separation, independent scaling.
- **EventBus interface** — CDC source pluggable. Could swap Debezium → MongoDB Change Streams → Postgres LISTEN/NOTIFY without touching consumers.
- **Sync rules in TypeScript, not YAML** — full type safety, async logic possible, no DSL.
- **Stateless gateway** — client state (checkpoint) lives in client + Redis cache. Service instances interchangeable.
- **Field-level LWW + server-wins escape hatch** — pragmatic. CRDT documented as out-of-scope.
- **Snapshot endpoint for cold starts** — oplog TTL = 30d, longer-history clients need direct Postgres read.
- **No mobile CRUD REST on RBAC** — sync push is mobile write path. RBAC's gRPC `ApplyWrite` is server-side write entry. Same business code, different transport.

---

## 18. Out of scope

- Vector-clock or CRDT conflict resolution
- Multi-region active-active
- Real-time push to mobile (WebSocket subscriptions) — current design = client polls pull
- Schema migration coordination across millions of clients (basic version-diff used)
- Custom RN client implementation (separate workstream)
