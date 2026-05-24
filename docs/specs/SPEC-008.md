# SPEC-008: Sync Rules Engine and Bucket Resolver

## Goal

Implement the rule layer that decides which data a user can pull, which fields are projected, and which client writes are locally acceptable before RBAC performs authoritative authorization.

This spec combines sync rules and bucket resolution because pull filtering and write validation both depend on the same user context.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, section 9: sync rules engine.
- `SYNC_SERVICE_PLAN-v2.md`, section 10: bucket tags and resolver.
- `CLAUDE.md`: sync rules are TypeScript, not YAML/DSL.
- `docs/specs/SPEC-006.md`: `SyncUser` and bucket context.

## In Scope

- Define sync rule types.
- Add initial collection pull rules and write rules.
- Implement bucket resolver wildcard semantics.
- Implement `projectFields()`.
- Implement local `validateWrite()`.
- Add tests for role, operation, ownership, protected fields, and projection behavior.

## Out of Scope

- RBAC gRPC authorization.
- Push endpoint.
- Conflict resolution.
- Pull route implementation.
- Snapshot SQL generation.
- Dynamic runtime rule loading.

## Implementation Changes

Create `src/sync/syncRules.ts`:

- Export static TypeScript rule configuration.
- Bucket groups:
  - `by_region`: farms, plots, crops, action_events, inspections, gdc_submissions.
  - `by_user`: invoices, farm_members, attachments.
- Write rules for the collections listed in `SYNC_SERVICE_PLAN-v2.md`.

Create `src/sync/syncRulesEngine.ts`:

- `projectFields(entry)` returns an entry with `delta` and `fullDoc` limited to allowed fields when a projection exists.
- `validateWrite(write, user)` checks:
  - collection has a write rule.
  - user has at least one allowed role.
  - operation is allowed.
  - ownership check passes.
  - protected fields are removed from payload.
- Return a cleaned write or throw `ValidationError`.

Extend `src/buckets/bucketResolver.ts` if needed:

- `resolveBuckets(user)` from `SPEC-006` remains the source of bucket tags.
- Add `bucketMatchesUser(bucket, userBuckets)` to support tenant wildcard matching.
- Wildcard bucket `tenant:<id>:*` matches tenant regional and user buckets for the same tenant only.

## Write Request Type

Define a local type in `src/sync/syncTypes.ts`:

```ts
export interface WriteRequest {
  collection: string;
  docId: string;
  operation: "insert" | "update" | "delete";
  payload: Record<string, unknown>;
  clientTimestamp: string;
  baseSeq: number;
  clientSeq: number;
  idempotencyKey: string;
}
```

## Test Plan

Add `tests/unit/syncRules.test.ts`:

- Field agent can write allowed regional farm update.
- Disallowed role fails.
- Disallowed operation fails.
- Ownership check failure fails.
- Protected fields are stripped.
- Projection removes server-only fields from `delta` and `fullDoc`.
- Unknown collection fails validation.

Add/extend `tests/unit/bucketResolver.test.ts`:

- Region and user bucket generation.
- Tenant admin wildcard.
- Wildcard matching is tenant-scoped.

## Acceptance Criteria

- Sync rules are static TypeScript.
- Rule engine has no RBAC network dependency.
- Protected fields are stripped before cleaned writes leave the engine.
- Bucket wildcard matching is explicit and tenant-scoped.
- `npm run build` passes.
- `npm run test` passes.

## Follow-Up Specs

- `SPEC-009`: Pull endpoint.
- `SPEC-010`: Conflict resolution.
- `SPEC-011`: Push endpoint and RBAC gRPC clients.
