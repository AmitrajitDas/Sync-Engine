# SPEC-033: Priority Buckets and Partial Sync

## Goal

Allow sync rules to assign a priority to each bucket. Pull, snapshot, and (later) streaming pull deliver higher-priority buckets first. Mobile clients can boot with critical buckets only and defer the rest, matching PowerSync's partial-sync behavior.

## Source References

- `src/sync/syncRules.ts` and `src/buckets/bucketTypes.ts`.
- `src/gateway/routes/pull.ts`, `snapshot.ts`.
- SPEC-024 (collection → bucket strategy mapping).

## Semantics

- `priority: number`, 0 = highest, increasing = later. Default 100.
- Two scopes:
  - **Bucket group priority** (default for all collections in the group).
  - **Collection-level override** (optional).
- Pull request accepts `priorityMax?: number`:
  - Server filters entries to buckets whose effective priority ≤ `priorityMax`.
  - Absent → no filter (all priorities).
- Within a single pull page, entries are ordered by `(priority ASC, seq ASC)` so the client always finishes priority N before N+1.

## In Scope

- Extend `pullRules` per-collection with optional `priority?: number`.
- Per `BUCKET_GROUPS` entry: optional default priority. Define defaults:
  - `by_region`: priority 10 (core operational data).
  - `by_user`: priority 20 (personal: invoices, attachments).
- Bucket resolver attaches priority metadata: returns `{ bucket: string; priority: number }[]`.
- Pull route:
  - Accept `priorityMax`.
  - Mongo query orders by `(seq ASC)` still; server uses an in-memory priority map for sort key composition. Index on `(bucket, seq)` already supports the bucket filter; server post-sorts per page by priority.
- Snapshot endpoint:
  - `priorityMax` query param. Filters collections by priority.

## Out of Scope

- Per-document priority.
- Adaptive priority based on usage analytics.

## Implementation Changes

- `src/sync/syncRules.ts`:
  ```typescript
  export interface PullRule {
    allowedFields?: string[];
    bucketGroup: "by_region" | "by_user";
    priority?: number;
  }
  export const BUCKET_GROUP_PRIORITY = { by_region: 10, by_user: 20 } as const;
  ```
- `src/buckets/bucketResolver.ts`:
  - New `resolveBucketsWithPriority(user): { bucket: string; priority: number; group: "by_region"|"by_user" }[]`.
  - `resolveBuckets` keeps its signature, delegates internally.
- `src/gateway/schemas/pullSchema.ts`:
  - Add `priorityMax: Type.Optional(Type.Number())` on request.
- `src/gateway/routes/pull.ts`:
  - When `priorityMax` set, derive bucket set as `{ bucket | priority(bucket) <= priorityMax }`.
  - Within returned entries, server sorts by `priority` ascending using the bucket's group priority.
- `src/gateway/routes/snapshot.ts`:
  - Accept `priorityMax`. Filter requested collections accordingly.
- Metrics:
  - `sync_pull_priority_bucket_total` (Counter, label `priority`).

## Error Handling

- `priorityMax` negative or non-integer → `ValidationError`.
- Empty bucket set after priority filter → return empty payload with `hasMore=false`.

## Test Plan

- Unit `tests/unit/bucketResolver.test.ts`:
  - Returns priorities matching `BUCKET_GROUP_PRIORITY` + per-collection overrides.
- Unit `tests/unit/pullRoute.test.ts`:
  - Two buckets, priorities 10 and 20. Pull with `priorityMax=15` returns only priority-10 entries.
  - Ordering: low-priority entries precede high-priority within the same page.
- Unit `tests/unit/snapshot.test.ts`:
  - `priorityMax=15` skips low-priority collections.

## Acceptance Criteria

- Pull + snapshot honor `priorityMax`.
- Default behavior (no `priorityMax`) unchanged.
- `npm run test` green; `npm run build` green.

## Follow-Up Specs

- SPEC-034 streaming pull pages by priority frame: priority N completes before N+1 streams.
