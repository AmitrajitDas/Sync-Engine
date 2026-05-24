# SPEC-026: EventBus Consumer Ordering, Cache Monotonicity, Oplog Idempotency

## Goal

Three coupled correctness issues on the CDC → EventBus → oplog → cache path:

1. Bug #3 — `InProcessEventBus.publish` runs consumers via `Promise.allSettled`. `OplogConsumer` (which assigns the `seq`) and `SubscriptionNotifier` (which broadcasts the seq) race; notifier always sends `seq=0`.
2. Bug #4 — concurrent `OplogConsumer.handle` calls for the same bucket set the Redis checkpoint key without monotonic enforcement, allowing the cache to regress and the pull fast-path to skip real entries.
3. Bug #5 — Kafka retry on consumer failure can re-deliver the same CDC event; the oplog has no idempotency key, producing duplicate entries with distinct `seq` numbers.

## Source References

- `src/eventbus/InProcessEventBus.ts:28-45`.
- `src/eventbus/consumers/OplogConsumer.ts:16-25`.
- `src/eventbus/consumers/SubscriptionNotifier.ts:13-21` — comment acknowledges the race.
- `src/oplog/oplogIndexes.ts` — no unique idx on CDC offset.
- `src/gateway/routes/pull.ts:44-60` — fast-path relies on cache.

## In Scope

### EventBus ordering

- Introduce an explicit consumer ordering: `OplogConsumer` first, then notifiers.
- Change `InProcessEventBus`:
  - Consumers receive an ordinal (`priority: number` on `EventBusConsumer`, default `100`; smaller runs first).
  - `publish` invokes consumers grouped by priority, in ascending order; consumers within the same priority still run via `Promise.allSettled`.
  - Earlier-priority failure aborts later-priority execution and surfaces the failure to Kafka.
- `EventBusConsumer.handle` may return a value; the bus threads each consumer's return into a per-event context map keyed by consumer name so later consumers can read it.
  - Concretely: `OplogConsumer.handle` returns `{ seq: number }`. Bus passes `{ persistedSeq: number }` into `SubscriptionNotifier.handle`.

### Cache monotonicity

- Replace `redis.set(key, value)` in `OplogConsumer` with an atomic max:
  - Prefer Redis 7 `SET key value GT` (sets only if numeric value greater than current). Fall back to a small Lua script: `EVAL "local cur=tonumber(redis.call('GET',KEYS[1])); if not cur or tonumber(ARGV[1])>cur then redis.call('SET',KEYS[1],ARGV[1]); end; return 1"`.
- Same logic applies to a new wildcard cache key (`tenant:<tenantId>:*`) so admin pulls have a real fast-path.

### Oplog idempotency

- Extend `OplogEntry` with `cdcEventId: string` — derived as `${cdcSourceTopic}:${cdcOffset}` when both present, else `${cdcLsn}` for CDC origin, else `${clientId}:${clientSeq}` for client-origin synthetic events.
- Add unique sparse index `{ cdcEventId: 1 }` in `oplogIndexes.ts`.
- `OplogService.appendToOplog`: on `MongoError` E11000 duplicate-key, treat as "already persisted" — re-read the existing row by `cdcEventId` and return it. Do not assign a fresh `seq`.

## Out of Scope

- Multi-instance bus (KafkaEventBus). In-process only.
- Transactional outbox in Mongo.

## Implementation Changes

- `src/eventbus/EventBus.ts`: add optional `priority?: number` and update typing for `handle(event, ctx?)`.
- `src/eventbus/InProcessEventBus.ts`: implement priority grouping + context threading.
- `src/eventbus/consumers/OplogConsumer.ts`:
  - `priority = 10`.
  - Return `{ seq }` from `handle`.
  - Use atomic-max cache write helper.
  - Also write `tenant:<tenantId>:*` cache key.
- `src/eventbus/consumers/SubscriptionNotifier.ts`:
  - `priority = 50`.
  - Receive `ctx.persistedSeq`; pass real seq to `registry.notify` and `fanout.publish`.
- `src/oplog/oplogSchema.ts`: add `cdcEventId?: string`.
- `src/oplog/oplogIndexes.ts`: new unique sparse idx `{ cdcEventId: 1 }`.
- `src/oplog/oplogService.ts`: handle E11000 by lookup + return.
- `src/cdc/postgresChangeNormalizer.ts`: set `cdcEventId`.
- New helper `src/oplog/checkpointCache.ts` with `setMonotonic(key, seq)`.

## Error Handling

- Duplicate-key insert is not an error — log at debug, return the existing entry.
- Atomic-max Lua failure: log + retry once; second failure surfaces as `DependencyUnavailableError` (Kafka will retry).

## Test Plan

- Unit `tests/unit/eventBus.test.ts`:
  - Consumer registered with `priority=10` runs to completion before `priority=50` starts.
  - Context from earlier consumer reaches later consumer.
  - Failure at lower priority aborts higher priority.
- Unit `tests/unit/oplogConsumer.test.ts`:
  - Notifier receives real seq, not 0.
- Unit `tests/unit/checkpointCache.test.ts`:
  - Concurrent writes 100, 99, 101: final value is 101 regardless of order.
- Integration `tests/integration/oplogIdempotency.test.ts`:
  - Same Debezium offset published twice → exactly one oplog row.
  - Second `appendToOplog` returns the same entry as the first.

## Acceptance Criteria

- `SubscriptionNotifier` no longer sends `seq=0`.
- Cache never regresses under concurrent CDC.
- Replay of identical Kafka offset produces zero duplicate oplog rows.
- `npm run test` green.

## Follow-Up Specs

- SPEC-029: poison-message handling now that we trust no-duplicate semantics.
- SPEC-034: streaming pull consumes the real seq from `SubscriptionNotifier`.
