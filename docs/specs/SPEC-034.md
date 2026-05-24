# SPEC-034: WebSocket Streaming Pull Protocol

## Goal

Replace REST polling with a PowerSync-style long-lived WebSocket stream. Server pushes oplog frames as soon as the EventBus sees a new entry; the existing `/sync/pull` REST endpoint remains as a fallback for clients without WebSocket connectivity.

## Source References

- `src/gateway/routes/subscribe.ts` — current notification-only WS.
- `src/realtime/subscriptionRegistry.ts`, `redisFanout.ts`.
- `src/eventbus/consumers/SubscriptionNotifier.ts` — after SPEC-026, carries real `seq`.
- SPEC-031 op-type taxonomy, SPEC-032 checksums, SPEC-033 priorities — all surface in the stream.

## Protocol

URL: `GET /sync/stream` (replaces the notify-only `subscribe`).

### Client → server frames

```json
{ "type": "start", "buckets": [...], "checkpoints": { "<bucket>": { "seq": 1234, "csum": 87 } }, "priorityMax": 20, "collections": ["farms"] }
{ "type": "ack", "checkpoint": 1500 }
{ "type": "pause" }
{ "type": "resume" }
```

### Server → client frames

```json
{ "type": "checkpoint", "bucket": "...", "seq": 1500, "csum": 102 }
{ "type": "data", "priority": 10, "entries": [ <OplogEntry> ... ] }
{ "type": "checkpoint_complete", "priority": 10 }
{ "type": "data", "priority": 20, "entries": [...] }
{ "type": "checkpoint_complete", "priority": 20, "final": true }
{ "type": "error", "code": "...", "message": "..." }
```

### Lifecycle

1. Client sends `start`. Server resolves buckets + priority list.
2. For each priority level in ascending order:
   a. Server queries oplog `seq > checkpoint AND bucket IN buckets AT this priority`, streams in batches of `STREAM_BATCH_SIZE` (config, default 100). Each batch = one `data` frame.
   b. Sends `checkpoint_complete` for the priority.
3. After backfill completes, server flips to live mode. EventBus consumer (`StreamConsumer`) is registered per connection; new oplog entries become `data` frames.
4. Server expects `ack` after every `data` frame; if not received within `ACK_TIMEOUT_MS`, pause sending. Resume on `ack` or `resume`.
5. Heartbeat ping every 30s; idle timeout 120s without pong.

## In Scope

- New `src/gateway/routes/stream.ts` implementing the protocol above.
- New `src/realtime/streamSession.ts`:
  - Manages per-connection backfill + live cursor.
  - Backpressure via outstanding `ack` window (sliding window of size 1, configurable).
- EventBus integration:
  - `SubscriptionNotifier` (post SPEC-026) calls `streamSession.deliver(event, persistedSeq)`.
  - Sessions deliver only events whose bucket is in the session's set and whose priority ≤ session's `priorityMax`.
- Cross-instance fan-out via existing `RedisFanout`:
  - Other instances also call `streamSession.deliver` for sessions they hold. Each instance only delivers events to its own connections.
  - For events originating elsewhere, the receiving instance reads the entry from oplog by `seq` if the event payload size is too large to fit in the Redis message (default: always read by seq; pub/sub carries only `{bucket, seq}`).
- Keep `/sync/pull` working as a no-op-changes fallback.

## Out of Scope

- Authentication other than the shared `verifyToken` decoration from SPEC-028.
- Server-side prioritization across multiple WS connections on the same node (fair queueing).

## Implementation Changes

- `src/gateway/routes/stream.ts` — new route.
- `src/realtime/streamSession.ts` — new module.
- `src/realtime/subscriptionRegistry.ts` — extend to track sessions:
  - `add(session: StreamSession)` / `remove`.
  - `deliver(bucket, seq)` looks up sessions, calls `session.deliver`.
- `src/realtime/redisFanout.ts`:
  - Carry `{ bucket, seq }` only. Sessions fetch the full entry from oplog if not in cache.
- `src/eventbus/consumers/SubscriptionNotifier.ts`:
  - Calls into `subscriptionRegistry.deliver` (which now serves stream sessions).
- Metrics:
  - `sync_stream_active_connections` (Gauge).
  - `sync_stream_frame_total` (Counter, label `type`).
  - `sync_stream_backpressure_paused_total` (Counter).

## Error Handling

- Invalid `start` frame → `error` frame with code `bad_request`, close with 4400.
- Auth failure → `error` frame, close with 4401.
- Backfill query error → `error` with code `oplog_unavailable`, close with 1011.
- Live mode error during `deliver` → log + close 1011; client reconnects with same checkpoints (idempotent backfill resumes from where it left off).

## Test Plan

- Unit `tests/unit/streamSession.test.ts`:
  - Backfill paginates correctly; emits `checkpoint_complete` per priority.
  - Backpressure: without `ack`, sends pause after first frame.
  - Pause/resume frames respected.
- Integration `tests/integration/stream.test.ts`:
  - Client opens stream, receives backfill, then inserts an oplog entry → client sees `data` frame.
  - Cross-instance: insert oplog on instance A, client connected to instance B receives `data` frame.

## Acceptance Criteria

- New stream route works end-to-end with backfill + live mode.
- Existing pull REST endpoint untouched and still passing tests.
- Backpressure observable via metrics.
- `npm run test` green; `npm run build` green.

## Follow-Up Specs

- Streaming-pull client SDK (separate workstream).
- Stream rate limiting per user.
