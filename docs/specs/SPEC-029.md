# SPEC-029: Conflict Resolver and CDC Pipeline Hardening

## Goal

Two production-readiness improvements on the CDC and conflict paths:

1. Bug #21 — `ConflictResolver.replayDocument` loads the full per-doc history on every push, unbounded by retention or hot-doc frequency.
2. Bug #22 — `DebeziumKafkaConsumer.eachMessage` throws on any malformed envelope or invalid row, causing KafkaJS to retry the same offset forever and stalling the partition.

Also wires the missing CDC consumer-lag metric (plan §12.4).

## Source References

- `src/conflicts/conflictResolver.ts:19-27`.
- `src/oplog/oplogService.ts:68-76` (`replayDocument`).
- `src/cdc/DebeziumKafkaConsumer.ts:31-54`.
- `src/observability/metrics.ts:49-54` (`cdcConsumerLag` defined, never used).

## In Scope

### Conflict resolver bounded scan

- `OplogService.getLatestForDocument(collection, docId): Promise<OplogEntry | null>`:
  - `find({ collection, docId }).sort({ seq: -1 }).limit(1).next()`.
  - Uses existing `{ collection: 1, docId: 1, seq: -1 }` index.
- `ConflictResolver.resolve` calls `getLatestForDocument` and wraps the result in a single-element array for strategy compatibility, or — preferred — refactor `ConflictContext` to carry `serverLatest: OplogEntry | null` directly and update strategies.
- Keep `replayDocument` for diagnostic / replay tooling.

### Poison-message handling

- `DebeziumKafkaConsumer` accepts an optional `dlq?: DLQHandler` interface:
  ```typescript
  interface DLQHandler {
    publish(topic: string, payload: Buffer, reason: string): Promise<void>;
  }
  ```
- On JSON parse failure or normalizer throw: log structured error, increment `cdcPoisonTotal` counter, call `dlq.publish` if configured, and **commit the offset** by returning normally from `eachMessage`.
- Without a DLQ: log + commit; metric still increments. Operator chooses whether to add a DLQ.
- Add classification: distinguish "unsupported op" / "missing field" / "JSON parse" via the metric `reason` label.

### Consumer lag metric

- Increment `cdcConsumerLag` in `eachMessage` keyed by `topic` after each processed message.
- Add a gauge `cdcConsumerLagSeconds` (new) computed from `message.timestamp` (ms epoch) vs current time when present.

## Out of Scope

- Backfilling failed events from DLQ.
- Per-collection LWW strategy changes (current map stays).

## Implementation Changes

- `src/oplog/oplogService.ts`: new `getLatestForDocument`.
- `src/conflicts/conflictTypes.ts`: `ConflictContext.serverLatest: OplogEntry | null` replacing `serverHistory: OplogEntry[]`.
- `src/conflicts/strategies/lastWriteWins.ts` & `serverWins.ts`: use `serverLatest` instead of `serverHistory[serverHistory.length - 1]`.
- `src/conflicts/conflictResolver.ts`: call `getLatestForDocument`.
- `src/cdc/DebeziumKafkaConsumer.ts`:
  - Accept `dlq?: DLQHandler` in options.
  - Wrap `eachMessage` body in try/catch with classified poison handling.
  - Increment metrics.
- `src/observability/metrics.ts`:
  - New `cdcPoisonTotal = new Counter({ name: "sync_cdc_poison_total", labelNames: ["topic", "reason"] })`.
  - New `cdcConsumerLagSeconds = new Gauge({ name: "sync_cdc_consumer_lag_seconds", labelNames: ["topic"] })`.

## Error Handling

- DLQ publish failure: log; still commit the offset (do not block the partition on DLQ availability).
- Conflict resolver: if `getLatestForDocument` fails (Mongo error), bubble as `DependencyUnavailableError`.

## Test Plan

- Unit `tests/unit/conflictResolver.test.ts`:
  - Adapted to `serverLatest` API.
  - LWW with a single latest entry produces the same merge as before.
- Unit `tests/unit/oplogService.test.ts`:
  - `getLatestForDocument` returns the highest-seq entry for a given `(collection, docId)`.
- Unit `tests/unit/debeziumConsumer.test.ts`:
  - Bad JSON → DLQ called with raw payload and reason `parse_error`; offset committed (consumer continues).
  - Unsupported op → DLQ called with reason `unsupported_op`.
  - Successful event → `cdcConsumerLag` incremented.

## Acceptance Criteria

- `ConflictResolver` performs one indexed lookup per push (not a full history scan).
- A bad message no longer halts the partition.
- `sync_cdc_poison_total` and `sync_cdc_consumer_lag_seconds` exposed at `/metrics`.
- `npm run test` green.

## Follow-Up Specs

- SPEC-031 changes the conflict-relevant fields once op-type taxonomy lands; resolver code touched here will need a minor adjustment.
