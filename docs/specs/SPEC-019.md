# SPEC-019: Local Infrastructure and Configuration

## Goal

Provide the local dev/test infrastructure the README already references: `docker-compose.yml`, `.env.example`, and a Debezium connector registration script so the full CDC pipeline runs locally.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, section 6.x: Debezium → Kafka → consumer.
- `CLAUDE.md`: Kafka topics `business.cdc.public.*`; required env vars.
- `README.md`: references `docker compose up -d` and `.env.example`.
- `src/config/env.ts`: required/optional env contract.

## In Scope

- Add `docker-compose.yml`: MongoDB, Redis, Kafka, Zookeeper, Postgres (RBAC stand-in for CDC source + read replica), Debezium Connect.
- Add `.env.example` with every var from `env.ts` plus `PG_READ_REPLICA_URL`.
- Add `scripts/register-debezium-connector.sh` posting a connector config for `public.*` tables with topic prefix `business.cdc.public.`.
- Add `docker compose config` to CI/build verification docs.

## Out of Scope

- Kubernetes manifests.
- Terraform / cloud resources.
- Production broker tuning.
- RBAC service image (Postgres-only stand-in for CDC).

## Implementation Changes

Create `docker-compose.yml`:

- `mongodb:6`, `redis:7`, `zookeeper`, `kafka` (KRaft or ZK), `postgres:16` (wal_level=logical), `debezium/connect`.
- Healthchecks per service.
- Named volumes for Mongo/Postgres.

Create `.env.example`:

- All required + optional vars with safe local defaults pointing at compose services.

Create `scripts/register-debezium-connector.sh`:

- `curl` POST to Kafka Connect `/connectors` with Postgres connector, `topic.prefix=business`, `schema.include.list=public`, `slot.name=sync_slot`.
- Idempotent (delete-then-create or check existing).

Update `README.md`:

- Document `docker compose up -d` then connector registration ordering.

## Error Handling

- Connector script: fail loudly if Connect not reachable; idempotent re-run.
- Compose: healthchecks gate dependent services.

## Test Plan

- `docker compose config` validates (no schema errors).
- Smoke: `docker compose up -d`, app starts, `/health/ready` returns 200 with all deps `ok`.
- Manual: insert Postgres row -> appears in `business.cdc.public.<table>` -> oplog entry -> pull returns it.

## Acceptance Criteria

- `docker-compose.yml` and `.env.example` exist and match `env.ts`.
- Connector script registers Debezium against local Postgres.
- `docker compose config` passes.
- Local pipeline produces oplog entries end to end.

## Follow-Up Specs

- `SPEC-017`: Postgres reader uses the same replica.
- `SPEC-023`: Integration tests reuse compose services.
