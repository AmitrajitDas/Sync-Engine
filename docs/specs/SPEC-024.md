# SPEC-024: Bucket-Aware CDC Normalization

## Goal

Fix the critical correctness bug where `postgresChangeNormalizer` emits region-scoped bucket tags for every collection, including `by_user` collections (`invoices`, `farm_members`, `attachments`). User-scoped CDC events never match a mobile client's user bucket, so those collections never sync.

## Source References

- `src/cdc/postgresChangeNormalizer.ts` — current normalizer hardcodes `tenant:<id>:region:<region>` for all rows.
- `src/sync/syncRules.ts` — `pullRules` defines `bucketGroup: "by_region" | "by_user"` per collection.
- `src/buckets/bucketTypes.ts` — `BUCKET_GROUPS` constant.
- `SYNC_SERVICE_PLAN-v2.md` §9.1 bucket definitions, §10 bucket resolver.

## In Scope

- Make bucket derivation collection-aware.
- For `by_region` collections: bucket = `tenant:<tenantId>:region:<region>`. Require `region` on the row.
- For `by_user` collections: bucket = `tenant:<tenantId>:user:<userId>`. Require a user-id column on the row (`user_id` for invoices/farm_members, `uploaded_by` for attachments).
- Per-collection mapping: collection → bucket group + user-id field name.
- Pass the collection identity into the normalizer so it can select the right scheme.

## Out of Scope

- Multi-bucket fan-out (one row → multiple buckets). Stays single-bucket for now.
- Wildcard `tenant:<id>:*` emission from CDC. Pull-side wildcard match already works.

## Implementation Changes

- New `src/cdc/bucketStrategy.ts`:
  ```typescript
  interface CollectionBucketStrategy {
    group: "by_region" | "by_user";
    userIdField?: string; // required when group = "by_user"
  }
  export const COLLECTION_BUCKETS: Record<string, CollectionBucketStrategy>;
  ```
  Map: `farms`, `plots`, `crops`, `action_events`, `inspections`, `gdc_submissions` → `by_region`. `invoices`, `farm_members` → `by_user` with `userIdField: "user_id"`. `attachments` → `by_user` with `userIdField: "uploaded_by"`.
- `postgresChangeNormalizer`:
  - Look up strategy by `collection`.
  - `by_region` path: keep current behavior, require `region`.
  - `by_user` path: read `activeRow[strategy.userIdField]`, build `tenant:<tenantId>:user:<userId>` bucket.
  - Throw on missing collection in map, missing required scope field.
- Single source of truth: `pullRules` and `COLLECTION_BUCKETS` must reference identical bucket groups; add a startup assertion (in `bucketTypes` or a new `bucketRegistry.ts`) that they match.

## Error Handling

- Unknown collection → throw `Error("No bucket strategy for collection: <name>")`. Surfaced by Kafka consumer; treated as poison (handled in SPEC-029).
- Missing `region` for `by_region` row or missing user-id field for `by_user` row → throw with explicit field name in the message.
- Normalizer never silently defaults to region.

## Test Plan

- Unit tests in `tests/unit/postgresChangeNormalizer.test.ts`:
  - `farms` CDC event with `region` → bucket `tenant:T:region:R`.
  - `invoices` CDC event with `user_id` → bucket `tenant:T:user:U`.
  - `attachments` CDC event with `uploaded_by` → bucket `tenant:T:user:U`.
  - Missing `user_id` for invoices → throws with field name.
  - Unknown collection → throws.
- Assertion test: `pullRules[k].bucketGroup === COLLECTION_BUCKETS[k].group` for every key.

## Acceptance Criteria

- All collections in `pullRules` have a `COLLECTION_BUCKETS` entry.
- User-scoped CDC events tagged with user bucket; verified by an integration test that pushes through `InProcessEventBus`.
- `npm run test` green.
- No regressions in existing `by_region` tests.

## Follow-Up Specs

- SPEC-029: poison-message handling in Kafka consumer once normalizer throws on bad rows.
