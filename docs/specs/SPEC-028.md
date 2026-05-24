# SPEC-028: Auth, Rate Limit, Snapshot, and Delta Bug Fixes

## Goal

Batch four small but critical fixes:

1. Bug #2 — `@fastify/rate-limit` runs on `onRequest` while `authPlugin` runs on `preHandler`, so `keyGenerator` never sees `request.user`. Per-user limits silently collapse to per-IP.
2. Bug #6 — `/sync/subscribe` plugin in `app.ts` is registered without `jwksUrl`/`issuer`, so every WebSocket connection is rejected.
3. Bug #8 — `/sync/snapshot` writes to `reply.raw` without `reply.hijack()`, conflicting with Fastify's response finalization.
4. Bug #9 — Debezium delta diff uses `before[k] !== after[k]`, marking nested-object columns changed on every update.

## Source References

- `src/gateway/plugins/rateLimiter.ts:23`.
- `src/gateway/plugins/auth.ts:87-100`.
- `src/app.ts:155-159` — subscribe registration.
- `src/gateway/routes/subscribe.ts:30-50`.
- `src/gateway/routes/snapshot.ts:90-125`.
- `src/cdc/postgresChangeNormalizer.ts:19-30`.

## In Scope

### Rate limit

- Move `authPlugin`'s verification from `preHandler` to `onRequest`, since JWT verify has no body dependency.
- Keep `tenantContextPlugin` on `preHandler` (it only reads `request.user`).
- Verify `keyGenerator` now sees `request.user.sub` for authenticated requests.

### WebSocket subscribe

- Reuse the shared auth path. Two options; this spec picks (b):
  - (a) Pass `jwksUrl` / `issuer` into `subscribeRoutes` from `index.ts`.
  - (b) Export a `verifyToken(token): Promise<SyncUser>` from `authPlugin` via `app.decorate("verifyToken", verifyToken)`; subscribe calls `app.verifyToken(rawToken)`.
- Remove duplicate JWKS bootstrap inside `subscribe.ts`.
- Subscribe still accepts the token via `?token=` query (WS can't carry Authorization header reliably from mobile).

### Snapshot hijack

- Call `reply.hijack()` before the first `stream.write`.
- Use `reply.raw.writeHead(200, { ... })` to send headers explicitly.
- Wrap streaming in try/finally that always calls `stream.end()`; on error before any write, send a normal Fastify error response (skip hijack).

### Delta diff

- Replace `before[k] !== after[k]` with `!util.isDeepStrictEqual(before[k], after[k])` (`node:util`).
- Confirm performance acceptable; CDC events are bounded in size.

## Out of Scope

- WebSocket flow control / backpressure (SPEC-034).
- Snapshot schema validation (SPEC-030 deferred).

## Implementation Changes

- `src/gateway/plugins/auth.ts`:
  - Hook on `onRequest` instead of `preHandler`.
  - Export `verifyToken` via decoration.
- `src/gateway/plugins/tenantContext.ts`: stays on `preHandler`.
- `src/app.ts`:
  - When registering `authPlugin`, also `app.decorate("verifyToken", ...)` from the plugin (move logic so it's reusable).
- `src/gateway/routes/subscribe.ts`:
  - Drop `jwksRsa`/`jwt` imports.
  - Use `app.verifyToken(token)` instead of building its own verifier.
- `src/gateway/routes/snapshot.ts`:
  - `reply.hijack()` then `reply.raw.writeHead(200, { "Content-Type": "application/x-ndjson" })`.
  - Stream NDJSON. On caught error, log and `reply.raw.end()`.
- `src/cdc/postgresChangeNormalizer.ts`:
  - Replace shallow inequality with `isDeepStrictEqual`.

## Error Handling

- `verifyToken` failure in subscribe: `socket.close(4401, "invalid token")`.
- Snapshot stream error mid-flight: end the response; no point retrying a partially-sent NDJSON stream.

## Test Plan

- Unit `tests/unit/rateLimiter.test.ts`:
  - Two requests from same user, different IPs → counted against the same key.
- Unit `tests/unit/auth.test.ts`:
  - `request.user` populated by `onRequest`-time when an `onRequest` hook reads it (simulated via a probe hook registered after auth).
- Unit `tests/unit/subscribe.test.ts` (mock app):
  - With `app.verifyToken` decorated, valid token → registry add; invalid → 4401.
- Unit `tests/unit/postgresChangeNormalizer.test.ts`:
  - Update with identical nested-object field on `before` and `after` does not include the field in `delta`.
  - Update with changed primitive field includes only that field.
- Integration `tests/integration/snapshot.test.ts`:
  - Pipe response to a sink; assert NDJSON terminator + meta line; no "headers already sent" warning in logs.

## Acceptance Criteria

- Per-user rate limit observable in tests (same user, different IP collapses to one bucket).
- WebSocket connection accepted with valid token via the shared verifier; no duplicate JWKS client in the codebase.
- Snapshot route uses `reply.hijack()` and writes valid NDJSON.
- Delta diff stable for unchanged nested fields.
- `npm run test` green; `npm run build` green.

## Follow-Up Specs

- SPEC-034: streaming pull replaces subscribe semantics, but the auth fix here lands first.
