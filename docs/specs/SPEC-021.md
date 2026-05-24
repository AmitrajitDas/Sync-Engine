# SPEC-021: Real-Time Push via WebSocket Subscriptions

## Goal

Add server-initiated change notification so mobile clients learn about new data without polling `/sync/pull`. Clients subscribe to their buckets over a WebSocket; the server pushes checkpoint advances (and optionally inline deltas) as oplog entries land.

This was plan §18 out-of-scope (poll-only). Now in scope. It breaks the stateless-gateway assumption (plan §17) and requires cross-instance fan-out design.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, section 17: stateless gateway tradeoff.
- `SYNC_SERVICE_PLAN-v2.md`, section 18: previously out-of-scope WebSocket push.
- `docs/specs/SPEC-004.md`: EventBus consumer model.
- `docs/specs/SPEC-006.md`: JWT auth, bucket context.
- `docs/specs/SPEC-009.md`: pull semantics (client still pulls after notify).

## In Scope

- Add `@fastify/websocket`.
- `GET /sync/subscribe` WebSocket endpoint with JWT handshake (reuse auth plugin logic).
- Per-connection bucket subscription registry (buckets derived from token, same resolver as pull).
- New `EventBusConsumer` (`SubscriptionNotifier`) that, on each published event, notifies local sockets whose buckets match.
- Cross-instance fan-out via Redis pub/sub so an event consumed on instance A reaches sockets on instance B.
- Notification payload: `{ type: "checkpoint", bucket, seq }`. Client responds by issuing a normal `/sync/pull`.
- Heartbeat ping/pong; idle timeout; clean unregister on close.
- Resume hint: client sends last known `seq` on connect; server sends immediate `checkpoint` if oplog is ahead.

## Out of Scope

- Inline full-delta streaming (notify-then-pull only this spec).
- Guaranteed delivery / offline queueing (client falls back to pull on reconnect).
- Mobile client implementation.
- Replacing the pull endpoint (pull remains source of truth).

## Implementation Changes

Add dependency `@fastify/websocket`.

Create `src/realtime/subscriptionRegistry.ts`:

- In-memory `Map<bucket, Set<connection>>`.
- `add(conn, buckets)`, `remove(conn)`, `notify(bucket, seq)`.

Create `src/realtime/redisFanout.ts`:

- Publish `{ bucket, seq }` to channel `sync:events`.
- Subscribe; on message call local registry `notify`.
- Dedupe self-published echoes by instance id.

Create `src/eventbus/consumers/SubscriptionNotifier.ts`:

- `EventBusConsumer`; on `handle(event)` -> local registry notify + Redis publish.
- Registered alongside `OplogConsumer` (after oplog append ordering not required; notify carries seq).

Create `src/gateway/routes/subscribe.ts`:

- WS upgrade; authenticate via `Authorization` header or `?token=`.
- Resolve buckets; register connection.
- Send resume `checkpoint` if `clientSeq < latestSeq`.
- Ping interval; on close/error unregister.

Update `src/app.ts` / `src/index.ts`:

- Register `@fastify/websocket`, subscribe route, notifier consumer, Redis fanout (separate Redis connections for pub and sub).

## Error Handling

- Invalid/expired token at handshake -> close with 4401.
- Redis pub/sub drop -> log, attempt reconnect; clients still safe via periodic pull.
- Backpressure: if socket buffer exceeds threshold, drop to "you are behind" signal (single coalesced notify), never queue unbounded.

## Test Plan

- `subscriptionRegistry.test.ts`: add/remove/notify, bucket fan-out, no leak on close.
- `subscribeRoute.test.ts`: rejects bad token; registers buckets; sends resume checkpoint.
- `redisFanout.test.ts` (mock Redis): cross-instance delivery, self-echo dedupe.
- `subscriptionNotifier.test.ts`: matching event notifies; non-matching bucket does not.
- Integration: two app instances + Redis; event on A notifies socket on B.

## Acceptance Criteria

- Client receives checkpoint notify within sub-second of oplog append, no polling.
- Notifications fan out across instances via Redis.
- Pull remains authoritative; notify never carries unauthorized data.
- Connection cleanup leaves no registry entries.
- Stateless-gateway tradeoff documented in a new ADR.
- `npm run build` passes.
- `npm run test` passes.

## Follow-Up Specs

- `SPEC-022`: Schema migration coordination.
- `SPEC-023`: Test suite.
