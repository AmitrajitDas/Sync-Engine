# Repository Guidelines

## Project Structure & Module Organization

This repository is currently pre-implementation. Treat `SYNC_SERVICE_PLAN-v2.md` as the source of truth for architecture, module boundaries, and scaffolded paths.

When scaffolded, keep source under `src/`, tests under `tests/`, protocol contracts under `proto/`, and operational docs under `docs/`. Planned key modules include `src/gateway/` for HTTP routes, `src/cdc/` for Debezium/Kafka ingestion, `src/oplog/` for MongoDB oplog logic, `src/sync/` for sync rules, `src/grpc/` for RBAC clients and generated stubs, and `src/config/` for validated environment setup.

## Build, Test, and Development Commands

Use the planned npm scripts once `package.json` is created:

```bash
npm run dev          # run Fastify locally with tsx watch
npm run build        # compile TypeScript to dist/
npm run start        # run compiled dist/index.js
npm run test         # run Vitest once
npm run test:watch   # run Vitest in watch mode
npm run proto:gen    # regenerate gRPC stubs from proto/
```

For a single test file, use:

```bash
npx vitest run tests/unit/postgresChangeNormalizer.test.ts
```

## Coding Style & Naming Conventions

Use strict TypeScript, ES2022, and NodeNext module resolution. Prefer small modules with explicit responsibility and typed interfaces at boundaries. Use `camelCase` for variables and functions, `PascalCase` for classes and types, and `*.test.ts` for tests.

Format with Prettier and lint with ESLint once configured. Keep comments short and reserved for non-obvious behavior.

## Testing Guidelines

Use Vitest for unit and integration tests. Unit tests should mock gRPC clients and use `InProcessEventBus`; integration tests may use Testcontainers for MongoDB, Redis, Kafka, and RBAC stubs.

Focus coverage on CDC normalization, bucket resolution, sync rules, conflict resolution, oplog queries, and push/pull route behavior.

## Commit & Pull Request Guidelines

This directory has no local Git history, so no repository-specific commit convention is established yet. Use concise imperative commits such as `Add oplog service indexes` or `Implement bucket resolver tests`.

Pull requests should include a short summary, test evidence, linked issue or task, and any environment or migration notes.

## Security & Configuration Tips

Never commit secrets. Mirror required variables in `.env.example`, including `MONGODB_URI`, `REDIS_URL`, `KAFKA_BROKERS`, `JWKS_URL`, and `RBAC_GRPC_ADDRESS`. JWT verification must use RBAC-issued RS256 tokens via JWKS; authorization decisions must remain delegated to RBAC gRPC.


<claude-mem-context>
# Memory Context

# [Sync-Engine] recent context, 2026-05-21 11:36pm GMT+5:30

No previous sessions found.
</claude-mem-context>