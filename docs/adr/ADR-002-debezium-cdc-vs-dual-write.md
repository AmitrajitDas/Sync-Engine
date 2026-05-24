# ADR-002: Debezium CDC over application dual-write

**Status:** Accepted

## Decision

Use Debezium to stream Postgres WAL changes to Kafka. Do not implement application-level dual-writes from RBAC into the oplog.

## Reasoning

- Debezium captures all writes including those from migrations, admin scripts, and bulk ops — not just application code paths.
- Dual-write requires RBAC to know about Sync's oplog schema, coupling the two services.
- CDC captures the exact committed state; dual-write risks divergence on transaction failure.

## Consequences

- Sync receives data with eventual consistency delay (WAL → Kafka → consumer).
- RBAC migration requirement: tables without a direct `region` column need a generated/denormalized column for bucket tagging.
