# ADR-008: Kafka consumer group offset for resume persistence

**Status:** Accepted

## Decision

Use Kafka consumer group offsets (committed via KafkaJS) as the durable resume mechanism. Do not persist offsets to an external store.

## Reasoning

- Kafka stores consumer group offsets durably in the `__consumer_offsets` topic.
- No additional external state (Redis, Postgres) is needed to resume after restart.
- KafkaJS commits offsets automatically after successful `eachMessage` handler completion.

## Consequences

- If a message handler throws, the offset is not committed and the message is reprocessed on restart — message processing must be idempotent.
- Consumer group ID (`KAFKA_CONSUMER_GROUP`) must be stable across deployments.
