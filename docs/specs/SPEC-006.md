# SPEC-006: Gateway Auth, Tenant Context, and Error Handling

## Goal

Add the gateway foundation required before sync protocol endpoints: JWT verification, request user context, bucket context, and centralized error mapping.

This spec protects `/sync/*` routes and standardizes error responses without implementing pull, push, snapshot, schema, or attachment behavior.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, sections 8.1-8.3: auth plugin, tenant context, error handler.
- `SYNC_SERVICE_PLAN-v2.md`, section 14.3: JWT claims contract.
- `CLAUDE.md`: RBAC issues RS256 JWTs via JWKS.
- `AGENTS.md`: authorization decisions remain delegated to RBAC gRPC.

## In Scope

- Add `SyncUser` request type.
- Add JWKS-based JWT verification for `/sync/*`.
- Validate issuer, expiration, and optional audience.
- Map RBAC JWT claims into normalized request user fields.
- Resolve bucket tags from user claims.
- Attach `request.user` and `request.buckets`.
- Add centralized error classes and Fastify error handler.
- Add unit tests for auth, tenant context, and error mapping.

## Out of Scope

- RBAC authorization checks.
- gRPC clients.
- Pull, push, checkpoint, snapshot, schema, or attachment endpoints.
- Rate limiting.
- Refresh token handling or JWT issuance.
- Admin/user management.

## Implementation Changes

Create `src/gateway/types.ts`:

- `SyncUser` with `sub`, `tenantId`, `tenantSlug`, `region`, `roles`, and `jti`.
- Fastify request type augmentation for `request.user` and `request.buckets`.

Create `src/gateway/plugins/auth.ts`:

- Register a `preHandler` for `/sync/*`.
- Read `Authorization: Bearer <token>`.
- Verify RS256 JWT using `JWKS_URL`.
- Validate `JWT_ISSUER`.
- Validate `JWT_AUDIENCE` only when configured.
- Map claims:
  - `sub` -> `sub`
  - `tenant_id` -> `tenantId`
  - `tenant_slug` -> `tenantSlug`
  - `region` -> `region`
  - `roles` -> `roles`
  - `jti` -> `jti`
- Throw `AuthError` for missing, invalid, expired, or malformed tokens.

Create `src/buckets/bucketTypes.ts` and `src/buckets/bucketResolver.ts`:

- Bucket strings:
  - `tenant:${tenantId}:region:${region}`
  - `tenant:${tenantId}:user:${userId}`
  - `tenant:${tenantId}:*`
- `resolveBuckets(user: SyncUser): string[]`.
- Include tenant wildcard only for `tenant_admin`.

Create `src/gateway/plugins/tenantContext.ts`:

- Requires `request.user`.
- Calls `resolveBuckets`.
- Attaches `request.buckets`.

Create `src/gateway/plugins/errorHandler.ts`:

- Add `AuthError`, `ValidationError`, `ConflictError`, `DependencyUnavailableError`.
- Map:
  - auth -> 401
  - validation -> 400
  - conflict -> 409
  - permission denied -> 403
  - unavailable -> 503
  - unknown -> 500

## Security Rules

- Do not authorize business actions locally; this layer only authenticates and derives context.
- Do not accept unsigned JWTs.
- Do not accept non-RS256 algorithms.
- Do not trust tenant/user values from request bodies over token claims.
- Do not log raw JWTs.

## Test Plan

Add `tests/unit/bucketResolver.test.ts`:

- Region bucket is added when region exists.
- User bucket is always added.
- Tenant admin wildcard is added only for `tenant_admin`.

Add `tests/unit/errorHandler.test.ts`:

- Each custom error maps to the expected status code.
- Unknown errors return 500.

Add `tests/unit/authPlugin.test.ts` with mocked JWKS/verification:

- Missing token returns 401.
- Valid claims attach `request.user`.
- Invalid issuer returns 401.
- Optional audience is enforced when configured.

## Acceptance Criteria

- `/sync/*` requests require a valid RBAC-issued JWT.
- `request.user` and `request.buckets` are available after auth/context plugins.
- Error responses use stable status codes and JSON shape.
- `npm run build` passes.
- `npm run test` passes.

## Follow-Up Specs

- `SPEC-007`: Checkpoint endpoint.
- `SPEC-008`: Sync rules engine and bucket resolver.
- `SPEC-009`: Pull endpoint.
