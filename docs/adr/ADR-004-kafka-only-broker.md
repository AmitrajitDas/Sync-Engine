# ADR-004: Kafka as the only message broker

**Status:** Accepted

## Decision

Use KafkaJS for consuming Debezium CDC events. Do not introduce RabbitMQ, SQS, or any secondary broker.

## Reasoning

- Debezium natively targets Kafka.
- Kafka consumer groups provide durable offset-based resume — no message loss on restarts.
- Simpler operational footprint than running multiple brokers.

## Consequences

- Kafka must be available for CDC to work; pull endpoint remains available from the oplog even if Kafka is down.
- Consumer lag is observable via Kafka consumer group metrics.
