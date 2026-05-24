# SPEC-005: CDC Normalization and Debezium Kafka Consumer

## Goal

Consume RBAC-owned Debezium Kafka topics, normalize Postgres row changes into `NormalizedChangeEvent`, and publish them to the in-process EventBus.

This spec connects the durable Kafka CDC source to the internal fan-out layer from `SPEC-004`. It does not add HTTP routes or sync protocol behavior.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, sections 6.4-6.6: Debezium normalizer, Kafka consumer, and tests.
- `SYNC_SERVICE_PLAN-v2.md`, section 7: EventBus boundary.
- `CLAUDE.md`: Kafka topics use `business.cdc.public.*`; resume is Kafka consumer offset.
- `docs/specs/SPEC-004.md`: `EventBus.publish()` accepts `NormalizedChangeEvent`.

## In Scope

- Add topic-to-collection resolution.
- Add Debezium envelope parsing and operation mapping.
- Compute update deltas from `before` and `after`.
- Extract bucket and tenant metadata from normalized rows.
- Add `DebeziumKafkaConsumer` using KafkaJS.
- Publish normalized events to EventBus.
- Add unit tests for normalization and topic resolution.

## Out of Scope

- Registering Debezium connectors.
- Owning RBAC Postgres schema or migrations.
- Implementing EventBus consumers beyond the existing oplog consumer.
- Fastify route wiring.
- End-to-end Testcontainers Debezium coverage.
- Kafka lag metrics and production alerting.

## Implementation Changes

Create `src/cdc/topicResolver.ts`:

- `resolveCollectionFromTopic(topic: string, prefix: string): string`
- Accept topics matching `${prefix}<tableName>`.
- Throw a clear error for topics outside the configured prefix.
- Return the table name as the collection name.

Create `src/cdc/postgresChangeNormalizer.ts`:

- Accept a Debezium envelope, collection name, and CDC metadata.
- Map Debezium ops:
  - `c` -> `insert`
  - `u` -> `update`
  - `d` -> `delete`
  - `r` -> `insert`
- Use `after.id` for insert/update/read `docId`; use `before.id` for delete.
- Use `after.tenant_id` or `before.tenant_id` for `tenantId`.
- Use `after.region` or `before.region` to build `bucket`.
- Bucket format: `tenant:${tenantId}:region:${region}`.
- For update deltas, include only fields where `before[field] !== after[field]`.
- Include `fullDoc` for insert/read and update when `after` exists.
- Include `cdcSourceTopic`, `cdcLsn`, and `cdcOffset` when available.
- Set `origin` to `"server"` by default unless CDC payload contains a trusted client-origin marker.

Create `src/cdc/DebeziumKafkaConsumer.ts`:

- Constructor dependencies: KafkaJS `Kafka`, `EventBus`, env fields, and optional logger.
- Subscribe with `topics: [new RegExp(...)]` using `KAFKA_CDC_TOPIC_PREFIX`.
- Use `KAFKA_CONSUMER_GROUP`.
- Parse `message.value` as JSON.
- Resolve collection from topic.
- Normalize the event.
- `await eventBus.publish(event)`.
- Expose `start()` and `stop()`.

## Error Handling

- Invalid JSON should throw from the message handler so KafkaJS does not commit successful processing silently.
- Unknown topic prefix should throw.
- Unsupported Debezium op should throw.
- Missing `id`, `tenant_id`, or `region` should throw because bucket tagging cannot be trusted.
- Do not retry manually in this spec; KafkaJS and consumer group replay semantics handle failed processing.

## Test Plan

Add `tests/unit/postgresChangeNormalizer.test.ts`:

- `c` insert maps to `insert`, `delta=after`, `fullDoc=after`.
- `u` update maps to changed-field delta and keeps `fullDoc`.
- `d` delete maps to `delete`, `delta=null`, and no `fullDoc`.
- `r` snapshot read maps to `insert`.
- Bucket extraction uses tenant and region.
- Missing required fields throw.
- CDC metadata is copied.

Add `tests/unit/topicResolver.test.ts`:

- Valid topic resolves to table/collection name.
- Invalid prefix throws.
- Prefix containing dots is handled literally.

Add `tests/unit/debeziumKafkaConsumer.test.ts` with mocked Kafka/EventBus:

- Subscribes to the configured topic regex.
- Publishes normalized events to EventBus.
- `stop()` disconnects/stops the underlying consumer.

## Acceptance Criteria

- CDC normalization produces `NormalizedChangeEvent`.
- Kafka consumer publishes normalized events to EventBus.
- No oplog write happens directly inside the Kafka consumer.
- `npm run build` passes.
- `npm run test` passes.

## Follow-Up Specs

- `SPEC-006`: Auth, tenant context, and gateway error handling.
- `SPEC-007`: Checkpoint endpoint.
- `SPEC-008`: Sync rules engine and bucket resolver.
