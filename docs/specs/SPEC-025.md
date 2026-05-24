# SPEC-025: Client Write Echo and write_checkpoint

## Goal

Fix Bug #7 (CDC echo never propagates `client_id`/`client_seq`, so `pollForCdcEcho` always times out and push responses never carry `serverSeq`) and implement PowerSync-style `write_checkpoint` semantics on the push path so clients can deterministically know when their own write has been observed by their next pull.

## Source References

- `src/cdc/postgresChangeNormalizer.ts` — hardcodes `origin: "server"`, never extracts client fields.
- `src/gateway/routes/push.ts:21-33` — `pollForCdcEcho` poll workaround.
- `src/grpc/BusinessProxyClient.ts:50-60` — request omits `client_id`.
- `proto/rbac.proto:56-61` — `ApplyWriteResponse` lacks `write_checkpoint`.
- `src/oplog/oplogSchema.ts` — `OplogEntry` already has `clientId`, `clientSeq`, `origin`.

## In Scope

- Propagate `client_id`, `client_seq` through the write → CDC → oplog pipeline.
- Normalizer reads `client_id` / `client_seq` from the Debezium row when present; sets `origin: "client"` accordingly. Defaults to `origin: "server"` when absent.
- BusinessProxy gRPC request includes `client_id`.
- Extend `ApplyWriteResponse` with `write_checkpoint` (int64) — the oplog `seq` at which the write is guaranteed observable (RBAC issues this when it commits the outbox row).
- Push route returns `write_checkpoint` per write in the response.
- Drop the 500 ms `pollForCdcEcho` workaround.
- Add a per-write `writeCheckpoint` field to `PushResponse` schema.

## Out of Scope

- RBAC-side persistence of `client_id`/`client_seq` into business rows. Documented as RBAC contract; sync code assumes they appear in the CDC row.
- Long-poll endpoint for clients waiting on a checkpoint. Client polls existing pull/checkpoint endpoints.

## Implementation Changes

- `proto/rbac.proto`:
  - Add `int64 write_checkpoint = 5;` to `ApplyWriteResponse`.
- `src/grpc/BusinessProxyClient.ts`:
  - Pass `client_id: clientId` in the request (currently a route-level field on push body — thread it through).
  - Map `res.write_checkpoint` → `ApplyWriteResult.writeCheckpoint`.
- `src/cdc/postgresChangeNormalizer.ts`:
  - Read `after.client_id` and `after.client_seq` from the row.
  - If both present and non-empty: `origin = "client"`, populate `clientId`, `clientSeq`.
  - Else: `origin = "server"` (current default).
- `src/gateway/routes/push.ts`:
  - Pass `body.clientId` into the BusinessProxy call.
  - Remove `pollForCdcEcho` and its constants.
  - Push response item: `{ docId, status, serverSeq?, writeCheckpoint?, serverVersion?, reason? }`.
  - Response `checkpoint` = `max(writeCheckpoint)` across applied writes.
- `src/gateway/schemas/pushSchema.ts`:
  - Add `writeCheckpoint: Type.Optional(Type.Number())` to `WriteResultSchema`.

## Error Handling

- If RBAC response lacks `write_checkpoint` (older RBAC): fall back to `serverSeq`. Log a warning once per process.
- Normalizer: malformed `client_seq` (non-numeric) → log + treat as server-origin.

## Test Plan

- Unit `tests/unit/postgresChangeNormalizer.test.ts`:
  - Row with `client_id` + `client_seq` → entry has `origin: "client"` and both populated.
  - Row without them → `origin: "server"`.
- Unit `tests/unit/push.test.ts`:
  - BusinessProxy returns `writeCheckpoint=1234` → push response item carries `writeCheckpoint: 1234`.
  - Multiple writes → response `checkpoint` is max of per-write checkpoints.
  - No poll happens; no `setTimeout`-based latency in the test.
- Integration `tests/integration/push.test.ts`:
  - Push → CDC echo → next pull surfaces the entry with `origin: "client"` and matching `clientSeq`.

## Acceptance Criteria

- `pollForCdcEcho` removed from `push.ts`.
- `client_id` reaches BusinessProxy.
- Normalizer correctly tags origin and propagates client identifiers.
- Push response always includes `writeCheckpoint` when RBAC supplies it.
- `npm run test` green; `npm run build` green.

## Follow-Up Specs

- SPEC-034 (WebSocket streaming pull) uses `writeCheckpoint` as the resume signal for client-originated writes.
