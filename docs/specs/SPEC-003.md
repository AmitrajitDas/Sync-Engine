# SPEC-003: Oplog Schema, Sequence Generation, and Oplog Service

## Goal

Implement the first real Sync Engine domain layer: the MongoDB-backed oplog.

This milestone defines the oplog entry shape, Mongo indexes, local sequence generation, and query/replay service used by later CDC, pull, checkpoint, and conflict-resolution work.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, section 6.1: oplog schema.
- `SYNC_SERVICE_PLAN-v2.md`, section 6.2: sequence generator strategies.
- `SYNC_SERVICE_PLAN-v2.md`, section 6.3: oplog service methods.
- `CLAUDE.md`: MongoDB is append-only oplog storage, TTL expires entries after 30 days.
- `docs/specs/SPEC-002.md`: local MongoDB and Redis infrastructure.

## In Scope

- Add typed oplog models in `src/oplog/oplogSchema.ts`.
- Add MongoDB index creation for the `oplog` collection.
- Add a `SequenceGenerator` interface.
- Add Redis `INCR` sequence fallback for local development.
- Add a placeholder interface for future RBAC/Postgres sequence generation.
- Implement `OplogService` for append, query, replay, latest sequence, document replay, and client write lookup.
- Add unit tests with mocked MongoDB collection behavior where possible.
- Add integration-test placeholders for real MongoDB/Testcontainers coverage in a later pass.

## Out of Scope

- Debezium envelope parsing.
- Kafka consumers.
- EventBus wiring.
- Pull, checkpoint, snapshot, or push HTTP routes.
- RBAC gRPC client implementation.
- Conflict resolution.
- Auth, tenant context, and sync rules.
- Production metrics, tracing, and alerting.

## Data Model

Create `src/oplog/oplogSchema.ts`.

Define:

```ts
import type { ObjectId } from "mongodb";

export type OplogOperation = "insert" | "update" | "delete";
export type OplogOrigin = "server" | "client";

export interface OplogEntry {
  _id: ObjectId;
  seq: number;
  timestamp: Date;
  collection: string;
  docId: string;
  operation: OplogOperation;
  delta: Record<string, unknown> | null;
  fullDoc?: Record<string, unknown>;
  bucket: string;
  tenantId: string;
  origin: OplogOrigin;
  clientId?: string;
  clientSeq?: number;
  cdcSourceTopic?: string;
  cdcLsn?: string;
  cdcOffset?: string;
}

export type NewOplogEntry = Omit<OplogEntry, "_id" | "seq">;
```

Rules:

- `seq` is monotonic and assigned only by `OplogService`.
- `timestamp` is supplied by the caller for CDC events and may use current clock for local/test entries.
- `delta` is `null` only for delete events.
- `fullDoc` is expected for insert events and optional for updates.
- `clientId` and `clientSeq` are only required for client-originated writes.

## MongoDB Indexes

Add index setup in `src/oplog/oplogSchema.ts` or a dedicated `src/oplog/oplogIndexes.ts`.

Indexes:

```ts
{ seq: 1, bucket: 1 }
{ timestamp: 1 } with expireAfterSeconds = OPLOG_TTL_DAYS * 86400
{ collection: 1, docId: 1, seq: -1 }
{ tenantId: 1, seq: -1 }
{ clientId: 1, clientSeq: 1 } with sparse = true
```

Acceptance detail:

- Index creation must be idempotent.
- TTL seconds must come from config, defaulting to 30 days.
- Do not create a unique index on `{ clientId, clientSeq }` yet; client-write idempotency policy is finalized in the push spec.

## Sequence Generation

Create `src/oplog/sequenceGenerator.ts`.

Define:

```ts
export interface SequenceGenerator {
  nextSeq(): Promise<number>;
}
```

Implement local Redis fallback:

```ts
export class RedisSequenceGenerator implements SequenceGenerator {
  constructor(private readonly redis: { incr(key: string): Promise<number> }) {}

  nextSeq(): Promise<number> {
    return this.redis.incr("sync:seq");
  }
}
```

Also define the future production boundary:

```ts
export class PostgresSequenceGenerator implements SequenceGenerator {
  async nextSeq(): Promise<number> {
    throw new Error("PostgresSequenceGenerator is not implemented until RBAC sequence contract is available");
  }
}
```

Rules:

- Redis sequence generation is local-dev only.
- The production strategy remains RBAC/Postgres-owned and must be implemented once the gRPC or SQL contract is available.
- No sequence should be derived from timestamps.

## Oplog Service

Create `src/oplog/oplogService.ts`.

Constructor dependencies:

```ts
import type { Collection } from "mongodb";

export class OplogService {
  constructor(
    private readonly collection: Collection<OplogEntry>,
    private readonly sequenceGenerator: SequenceGenerator,
  ) {}
}
```

Implement:

```ts
appendToOplog(entry: NewOplogEntry): Promise<OplogEntry>
getEntriesAfter(seq: number, buckets: string[], limit?: number): Promise<OplogEntry[]>
getLatestSeq(buckets?: string[]): Promise<number>
replayFromSeq(seq: number, buckets: string[]): AsyncIterable<OplogEntry>
replayDocument(collection: string, docId: string): Promise<OplogEntry[]>
replayFromTimestamp(from: Date, buckets?: string[]): AsyncIterable<OplogEntry>
findByClientWrite(clientId: string, clientSeq: number): Promise<OplogEntry | null>
```

Behavior:

- `appendToOplog` calls `sequenceGenerator.nextSeq()`, inserts the entry, and returns the persisted entry.
- `getEntriesAfter` filters by `seq > checkpoint` and `bucket in buckets`, sorted by ascending `seq`.
- `limit` defaults to `PULL_DEFAULT_LIMIT` and must not exceed `PULL_MAX_LIMIT`; if config is not wired into the service yet, accept an optional constructor options object for these limits.
- `getLatestSeq()` returns `0` when no entries exist.
- `replayFromSeq` and `replayFromTimestamp` use Mongo cursors and async iteration rather than loading all matching documents into memory.
- `replayDocument` returns entries for one collection/doc pair sorted by ascending `seq`.
- `findByClientWrite` returns the matching client-originated entry or `null`.

## Error Handling

- Let MongoDB driver errors surface to callers.
- Do not swallow insert failures.
- Do not retry writes in this service yet.
- Validate obvious invalid inputs:
  - empty `buckets` in bucket-filtered methods returns an empty result.
  - non-positive `limit` falls back to the default limit.
  - over-max `limit` clamps to max.

## Test Plan

Add `tests/unit/oplogService.test.ts`.

Test scenarios:

- Appending assigns the next sequence and inserts one document.
- `getEntriesAfter` filters by checkpoint and buckets.
- `getEntriesAfter` sorts ascending by `seq`.
- default limit is applied when no limit is provided.
- max limit clamps oversized requests.
- empty bucket list returns an empty result.
- `getLatestSeq` returns latest matching sequence.
- `getLatestSeq` returns `0` when no document exists.
- `replayDocument` returns document history in sequence order.
- `findByClientWrite` returns a matching entry.
- `findByClientWrite` returns `null` for no match.
- Redis sequence generator calls `INCR sync:seq`.
- Postgres sequence generator throws the explicit not-implemented error.

Optional later integration coverage:

- Real MongoDB index creation against Testcontainers.
- TTL index configuration check.
- Cursor replay over many entries.

## Acceptance Criteria

- `src/oplog/oplogSchema.ts` defines the oplog entry types.
- `src/oplog/sequenceGenerator.ts` defines sequence generators.
- `src/oplog/oplogService.ts` implements the required oplog methods.
- Unit tests cover append, query, limits, replay, latest seq, client write lookup, and Redis sequence generation.
- `npm run build` passes.
- `npm run test` passes.
- No CDC, Kafka, EventBus, HTTP route, auth, or RBAC gRPC logic is introduced in this spec.

## Follow-Up Specs

- `SPEC-004`: EventBus interface and in-process test bus.
- `SPEC-005`: CDC normalization and Debezium Kafka consumer.
- `SPEC-006`: Auth, tenant context, and gateway error handling.
- `SPEC-007`: Checkpoint and pull APIs.
