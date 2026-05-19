# SPEC-004: EventBus Interface and In-Process Consumers

## Goal

Add the internal event fan-out layer that decouples CDC/event producers from consumers such as the oplog writer.

This milestone introduces the EventBus contracts, an in-memory implementation for tests and local wiring, and the first consumer that writes normalized change events to the oplog.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, section 7.1: EventBus and `NormalizedChangeEvent` interfaces.
- `SYNC_SERVICE_PLAN-v2.md`, section 7.3: `InProcessEventBus` uses in-memory fan-out.
- `SYNC_SERVICE_PLAN-v2.md`, section 7.4: `OplogConsumer` writes events to the oplog.
- `CLAUDE.md`: EventBus decouples CDC source from consumers; tests use `InProcessEventBus`.
- `docs/specs/SPEC-003.md`: `OplogService.appendToOplog()` owns sequence assignment.

## In Scope

- Add `NormalizedChangeEvent`, `EventBusConsumer`, and `EventBus` types.
- Add `InProcessEventBus` with consumer registration and async fan-out.
- Add `OplogConsumer` that converts normalized events into oplog appends.
- Update Redis checkpoint cache after a successful oplog append.
- Add unit tests for event fan-out, failure behavior, duplicate registration, and oplog consumer behavior.

## Out of Scope

- Kafka consumer implementation.
- Debezium envelope parsing.
- Real Redis client setup.
- Fastify route wiring.
- MongoDB connection wiring in `src/index.ts`.
- Retry, dead-letter queues, tracing, metrics, and alerting.
- Additional consumers beyond `OplogConsumer`.

## Event Contracts

Create `src/eventbus/EventBus.ts`.

Define:

```ts
export interface NormalizedChangeEvent {
  collection: string;
  docId: string;
  operation: "insert" | "update" | "delete";
  delta: Record<string, unknown> | null;
  fullDoc?: Record<string, unknown>;
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

Rules:

- `NormalizedChangeEvent` intentionally matches `NewOplogEntry` from `SPEC-003`, but the EventBus type should not import oplog types.
- Producers publish normalized events only; raw Debezium envelopes remain out of scope.
- Consumers must expose stable unique names.

## InProcessEventBus

Create `src/eventbus/InProcessEventBus.ts`.

Behavior:

- Store consumers by `consumer.name`.
- `register()` throws an error if another consumer already uses the same name.
- `publish()` sends the event to all registered consumers.
- `publish()` must attempt every consumer even if one fails.
- After all consumers settle, `publish()` throws an `EventBusPublishError` if any consumer failed.
- If there are no consumers, `publish()` resolves successfully.

Define `EventBusPublishError` with:

```ts
export class EventBusPublishError extends Error {
  constructor(
    public readonly failures: Array<{ consumer: string; error: unknown }>,
  ) {
    super("One or more event bus consumers failed");
  }
}
```

Anti-patterns:

- Do not use Kafka here.
- Do not silently swallow consumer failures.
- Do not stop fan-out at the first failed consumer.

## OplogConsumer

Create `src/eventbus/consumers/OplogConsumer.ts`.

Constructor dependencies:

```ts
import type { OplogService } from "../../oplog/oplogService.js";

export interface CheckpointCache {
  set(key: string, value: string): Promise<unknown>;
}

export class OplogConsumer implements EventBusConsumer {
  readonly name = "oplog";

  constructor(
    private readonly oplog: OplogService,
    private readonly checkpointCache?: CheckpointCache,
  ) {}
}
```

Behavior:

- `handle(event)` calls `oplog.appendToOplog(event)`.
- Use the returned persisted entry for the assigned `seq`.
- If `checkpointCache` is provided, set `sync:checkpoint:${event.bucket}` to the returned `seq`.
- If no cache is provided, still append to the oplog successfully.
- Let append/cache errors bubble to the EventBus.

Important boundary:

- Do not inject `SequenceGenerator` into `OplogConsumer`.
- Do not create `_id` or `seq` inside `OplogConsumer`.
- `OplogService` remains the single owner of sequence assignment.

## Test Plan

Add `tests/unit/eventBus.test.ts`.

Test scenarios:

- Registering a consumer and publishing calls its `handle()` once.
- Publishing with multiple consumers calls all consumers.
- Publishing with no consumers resolves successfully.
- Duplicate consumer names throw during registration.
- If one consumer fails, the other consumers still run.
- If any consumer fails, `publish()` rejects with `EventBusPublishError`.
- `EventBusPublishError.failures` includes the failing consumer name.

Add `tests/unit/oplogConsumer.test.ts`.

Test scenarios:

- `OplogConsumer.handle()` passes the event to `appendToOplog()`.
- It does not add `seq` before calling `appendToOplog()`.
- It writes `sync:checkpoint:<bucket>` using the persisted entry sequence.
- It works when no checkpoint cache is supplied.
- It propagates oplog append failures.
- It propagates checkpoint cache failures after a successful append.

## Acceptance Criteria

- `src/eventbus/EventBus.ts` defines the event and bus contracts.
- `src/eventbus/InProcessEventBus.ts` implements in-memory fan-out.
- `src/eventbus/consumers/OplogConsumer.ts` appends normalized events through `OplogService`.
- Consumer failures do not prevent other consumers from running.
- Publish failures are reported after fan-out completes.
- `npm run build` passes.
- `npm run test` passes.
- No Kafka, Debezium, HTTP route, or app startup wiring is added in this spec.

## Follow-Up Specs

- `SPEC-005`: CDC normalization and Debezium Kafka consumer.
- `SPEC-006`: Auth, tenant context, and gateway error handling.
- `SPEC-007`: Checkpoint and pull APIs.
