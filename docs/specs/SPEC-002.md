# SPEC-002: Local Infrastructure

## Goal

Create the local Docker Compose infrastructure needed before oplog, CDC, and integration work begins.

`SPEC-001` created the TypeScript/Fastify scaffold. This spec covers the next milestone only: local supporting services for development and future integration tests.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, section 5.3: planned Compose services.
- `SYNC_SERVICE_PLAN-v2.md`, section 13: implementation order.
- `docs/specs/SPEC-001.md`: follow-up spec list.
- Docker Compose service dependencies and healthchecks: <https://docs.docker.com/reference/compose-file/services/>
- Docker Compose profiles: <https://docs.docker.com/reference/compose-file/profiles/>
- Debezium Connect Docker image and REST API port: <https://hub.docker.com/r/debezium/connect>

## In Scope

- Add `docker-compose.yml` for local infrastructure.
- Include local services for MongoDB, Redis, Kafka, Zookeeper, Kafka UI, Debezium Connect, and MinIO.
- Configure named Docker volumes for stateful services.
- Add healthchecks where practical.
- Document host-facing and container-facing connection values.
- Add verification commands for bringing the stack up, checking readiness, and tearing it down.

## Out of Scope

- Registering Debezium connectors.
- Adding RBAC Postgres to this repository.
- Implementing Kafka consumers or CDC normalization.
- Connecting the Fastify app to MongoDB, Redis, Kafka, gRPC, or MinIO.
- Adding production orchestration, Kubernetes, Terraform, or secrets management.
- Adding app Dockerfile or containerizing the Sync service.

## Services

### MongoDB

- Service name: `mongo`
- Image: `mongo:7`
- Container port: `27017`
- Host port: `27017`
- Database name used by local config: `sync`
- Volume: `mongo_data`
- Healthcheck: run `mongosh --eval "db.adminCommand('ping')"`

MongoDB is oplog storage only. It does not need a replica set because this service watches Postgres CDC, not MongoDB change streams.

### Redis

- Service name: `redis`
- Image: `redis:7`
- Container port: `6379`
- Host port: `6379`
- Volume: `redis_data`
- Healthcheck: run `redis-cli ping`

Redis will later support checkpoint cache, JWKS cache, rate limits, and local sequence fallback.

### Zookeeper

- Service name: `zookeeper`
- Image: `confluentinc/cp-zookeeper:7.7.0`
- Container port: `2181`
- Host port: `2181`
- Required by the local Kafka image for this milestone.

### Kafka

- Service name: `kafka`
- Image: `confluentinc/cp-kafka:7.7.0`
- Internal listener: `kafka:9092`
- Host listener: `localhost:29092`
- Depends on healthy or started Zookeeper.
- Healthcheck: run a Kafka broker API version or topic-list command from inside the container.

Use both internal and host listeners so Docker services can use `kafka:9092` while host-run Node tests and tools can use `localhost:29092`.

### Kafka UI

- Service name: `kafka-ui`
- Image: `provectuslabs/kafka-ui:latest`
- Host port: `8081`
- Connects to Kafka at `kafka:9092`.
- Depends on Kafka.

This service is for local inspection only.

### Debezium Connect

- Service name: `debezium-connect`
- Image: `debezium/connect:latest`
- Host port: `8083`
- Connects to Kafka at `kafka:9092`.
- Uses internal topics for config, offsets, and status.
- Depends on Kafka.

This milestone starts Kafka Connect only. Connector registration belongs to a later CDC spec because RBAC owns the Postgres connector contract.

### MinIO

- Service name: `minio`
- Image: `minio/minio:latest`
- API host port: `9000`
- Console host port: `9001`
- Volume: `minio_data`
- Local-only credentials:
  - `MINIO_ROOT_USER=minioadmin`
  - `MINIO_ROOT_PASSWORD=minioadmin`
- Command: `server /data --console-address ":9001"`

MinIO is included for future attachment proxy testing. Sync still talks to RBAC for presign and download URL operations.

## Environment Guidance

Keep `.env.example` aligned with container hostnames for service-to-service values:

```bash
MONGODB_URI=mongodb://mongo:27017/sync
REDIS_URL=redis://redis:6379
KAFKA_BROKERS=kafka:9092
```

For running the Sync app directly on the host with `npm run dev`, document local override values:

```bash
MONGODB_URI=mongodb://localhost:27017/sync
REDIS_URL=redis://localhost:6379
KAFKA_BROKERS=localhost:29092
```

Do not commit real secrets. MinIO credentials in this spec are local-only defaults.

## Implementation Steps

1. Create `docker-compose.yml` at the repository root.
2. Add the seven services listed above.
3. Add named volumes:
   - `mongo_data`
   - `redis_data`
   - `kafka_data`
   - `zookeeper_data`
   - `zookeeper_log`
   - `minio_data`
4. Configure Kafka with both internal and host listeners.
5. Add healthchecks for MongoDB, Redis, Kafka, Debezium Connect, and MinIO.
6. Keep Debezium connector registration out of this file.
7. Add local infrastructure notes to `README.md` only if a README exists by the time this spec is implemented; otherwise leave README creation to a later documentation spec.

## Acceptance Criteria

- `docker compose config` validates the Compose file.
- `docker compose up -d` starts the local infrastructure stack.
- `docker compose ps` shows the expected services running.
- MongoDB responds to its ping healthcheck.
- Redis responds with `PONG`.
- Kafka can list topics from inside the Kafka container.
- Debezium Connect responds at `http://localhost:8083/connectors`.
- Kafka UI is reachable at `http://localhost:8081`.
- MinIO console is reachable at `http://localhost:9001`.
- Existing scaffold checks still pass with `npm run build` and `npm run test`.

## Verification Commands

Validate Compose:

```bash
docker compose config
```

Start services:

```bash
docker compose up -d
```

Check service status:

```bash
docker compose ps
```

Check Redis:

```bash
docker compose exec redis redis-cli ping
```

Check Kafka:

```bash
docker compose exec kafka kafka-topics --bootstrap-server kafka:9092 --list
```

Check Debezium Connect:

```bash
curl http://localhost:8083/connectors
```

Check existing app scaffold:

```bash
npm run build
npm run test
```

Stop services:

```bash
docker compose down
```

Remove local volumes only when intentionally resetting local state:

```bash
docker compose down -v
```

## Follow-Up Specs

- `SPEC-003`: Oplog schema, sequence generation, and oplog service.
- `SPEC-004`: EventBus interface and in-process test bus.
- `SPEC-005`: CDC normalization and Debezium Kafka consumer.
- `SPEC-006`: Auth, tenant context, and gateway error handling.
