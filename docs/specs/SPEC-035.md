# SPEC-035: Sync Rule Configuration Normalization

## Goal

Standardize the shape of sync rules so the codebase has a single declarative source of truth per collection, covering bucket assignment, pull projection, push validation, conflict strategy, and priority. Does not introduce a full DSL (PowerSync's biggest single piece of complexity is the SQL-like DSL parser; deferred). Instead consolidates the currently-scattered `pullRules`, `writeRules`, `LWW_COLLECTIONS`, `BUCKET_GROUPS`, and the implicit normalizer mapping into one registry.

## Source References

- `src/sync/syncRules.ts` — pull + write rules.
- `src/buckets/bucketTypes.ts` — `BUCKET_GROUPS` constant.
- `src/conflicts/conflictResolver.ts:7` — `LWW_COLLECTIONS` literal.
- `src/cdc/postgresChangeNormalizer.ts` — implicit collection knowledge (SPEC-024 introduces `COLLECTION_BUCKETS`).

## Target Shape

```typescript
// src/sync/syncRegistry.ts
export interface CollectionConfig {
  name: string;
  bucket: {
    group: "by_region" | "by_user";
    userIdField?: string;            // when group = "by_user"
    priority?: number;               // default from group
  };
  pull: {
    allowedFields?: string[];
  };
  write: {
    allowedRoles: string[];
    allowedOps: ("PUT" | "PATCH" | "REMOVE")[];   // taxonomy post SPEC-031
    protectedFields: string[];
    ownershipField?: string;
  };
  conflict: "lastWriteWins" | "serverWins";
}

export const COLLECTIONS: Record<string, CollectionConfig>;
```

## In Scope

- New `src/sync/syncRegistry.ts` containing the merged registry.
- Replace direct imports of `pullRules`, `writeRules`, `COLLECTION_BUCKETS`, `LWW_COLLECTIONS` with derivations from `COLLECTIONS`:
  - `pullRules[k] = { allowedFields: c.pull.allowedFields, bucketGroup: c.bucket.group, priority: c.bucket.priority }`.
  - `writeRules[k] = { ... }`.
  - `COLLECTION_BUCKETS[k] = { group, userIdField }`.
  - `LWW_COLLECTIONS = new Set(keys where conflict === "lastWriteWins")`.
- Startup assertion that every registry entry has the fields its bucket group requires (`userIdField` mandatory for `by_user`).
- Single export point: existing modules re-export the derived structures so call sites need not change.

## Out of Scope

- YAML / SQL-like DSL parser.
- Loading rules from disk at runtime.
- Per-tenant rule overrides.

## Implementation Changes

- `src/sync/syncRegistry.ts` — authoritative registry.
- `src/sync/syncRules.ts` — keep file as a thin compatibility re-export computed from the registry.
- `src/buckets/bucketTypes.ts` — derive from registry.
- `src/cdc/bucketStrategy.ts` (created in SPEC-024) — derive from registry.
- `src/conflicts/conflictResolver.ts` — derive `LWW_COLLECTIONS` from registry.

## Error Handling

- Startup validator runs on module load; misconfigured entry throws and prevents the service from starting (similar to `assertContiguousMigrations`).
- Examples of validation errors:
  - `by_user` without `userIdField`.
  - `conflict: "lastWriteWins"` paired with `allowedOps: ["REMOVE"]` only (no merge possible; warns rather than throws).

## Test Plan

- Unit `tests/unit/syncRegistry.test.ts`:
  - All current collections covered.
  - Validator throws when a registry entry omits required fields.
  - Derived `pullRules`/`writeRules`/`COLLECTION_BUCKETS`/`LWW_COLLECTIONS` match a snapshot of current behavior (no functional change).

## Acceptance Criteria

- Adding a new collection requires editing exactly one file (`syncRegistry.ts`).
- Derived structures keep their public APIs; existing tests unchanged.
- Startup validator catches misconfigurations.
- `npm run test` green; `npm run build` green.

## Follow-Up Specs

- A future DSL spec can replace this registry with a parser; until then this is the seam.
- Per-collection sync-config metrics (entries pulled, conflict rate) using the registry as the label source.
