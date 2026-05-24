# SPEC-027: Pull Route Correctness

## Goal

Fix three pull-route bugs:

1. Bug #18 — collections filter is applied client-side after limit; one hot collection can swamp a page so the requested collection returns near-empty results.
2. Bug #19 — when all fetched entries are filtered out and `hasMore=true`, the response checkpoint is unchanged; the client loops on the same range forever.
3. Bug #20 — `OplogService.replayFromSeq` and `replayFromTimestamp` return raw Mongo cursors typed as `AsyncIterable`; callers that break early leak the cursor.

## Source References

- `src/gateway/routes/pull.ts:62-95`.
- `src/oplog/oplogService.ts:61-88`.

## In Scope

- Push the `collections` filter into the Mongo query.
- Compute the response checkpoint from the maximum raw seq fetched (regardless of post-filter survivors).
- Wrap replay iterables in cursor-closing generators.

## Out of Scope

- Streaming pull (handled by SPEC-034).
- Bucket-priority ordering (SPEC-033).

## Implementation Changes

- `src/oplog/oplogService.ts`:
  - `getEntriesAfter(seq, buckets, options?: { limit?: number; collections?: string[] })`.
    - If `options.collections` non-empty, add `collection: { $in: options.collections }` to the filter.
  - `replayFromSeq` and `replayFromTimestamp`: wrap the cursor:
    ```typescript
    async function* iterate() {
      const cursor = this.collection.find(...).sort({ seq: 1 });
      try {
        for await (const doc of cursor) yield doc;
      } finally {
        await cursor.close();
      }
    }
    return iterate();
    ```
- `src/gateway/routes/pull.ts`:
  - Pass `collections` to `getEntriesAfter`.
  - Drop post-fetch `entries.filter`.
  - `rawMaxSeq = entries[entries.length - 1]?.seq ?? clientCheckpoint`.
  - `responseCheckpoint = rawMaxSeq`.
  - Continue using `entries.slice(0, effectiveLimit)` to honor the contract, and `hasMore = rawEntries.length > effectiveLimit`.

## Error Handling

- Empty `collections` array in request: treat as "no filter" (current behavior).
- Unknown collection name: silently filtered out by Mongo; no error (consistent with `syncRules` projection).

## Test Plan

- Unit `tests/unit/pull.test.ts`:
  - Mixed bucket containing 1000 `farms` + 1000 `plots`; pull with `collections: ["farms"]`, `limit=100` returns 100 `farms` entries.
  - All fetched entries excluded by filter (shouldn't happen now since filter is in DB, but assert): checkpoint advances to raw max.
- Unit `tests/unit/oplogService.test.ts`:
  - `replayFromSeq` cursor closed when consumer breaks early — assert `cursor.close` called via spy.
  - `getEntriesAfter` with `collections` returns only matching docs.

## Acceptance Criteria

- No post-filter step in `pull.ts`.
- Pull checkpoint advances even when filter excludes all results within the fetched batch.
- Replay iterables close their cursors on both completion and early break.
- `npm run test` green.

## Follow-Up Specs

- SPEC-033 builds on the `collections` parameter for priority ordering.
