# ADR-003: EventBus interface for CDC-to-consumer decoupling

**Status:** Accepted

## Decision

Introduce `EventBus` interface (`publish` / `register`) between the CDC consumer and downstream consumers (OplogConsumer etc.). `KafkaEventBus` wraps `DebeziumKafkaConsumer` in production; `InProcessEventBus` is used in tests.

## Reasoning

- Adding a new consumer (e.g., audit log, push notification) requires only `eventBus.register(consumer)` — no CDC consumer changes.
- Tests can drive the bus directly without Kafka.

## Consequences

- All consumers must implement `EventBusConsumer` interface.
- Fan-out failures are aggregated; a single slow consumer blocks `publish()`.
