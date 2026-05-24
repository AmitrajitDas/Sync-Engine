# SPEC-014: Attachment Proxy

## Goal

Add sync gateway attachment endpoints that proxy presign and download URL requests to RBAC while preserving RBAC as the owner of attachment storage policy.

## Source References

- `SYNC_SERVICE_PLAN-v2.md`, section 8.9: attachment proxy.
- `SYNC_SERVICE_PLAN-v2.md`, section 14.1: `AttachmentGrpc` dependency.
- `docs/specs/SPEC-006.md`: authenticated user context.

## In Scope

- Add `AttachmentClient` gRPC wrapper.
- Add `POST /sync/attachments/presign`.
- Add `GET /sync/attachments/:id/url`.
- Forward user JWT or user metadata to RBAC.
- Add request/response schemas.
- Add tests with mocked attachment client.

## Out of Scope

- Direct MinIO access from Sync.
- Upload finalization endpoint.
- Attachment virus scanning.
- Attachment metadata persistence.
- CDN configuration.

## API Contract

Presign request:

```json
{
  "parentType": "farm",
  "parentId": "farm-123",
  "contentType": "image/jpeg",
  "sizeBytes": 1048576
}
```

Download URL:

```http
GET /sync/attachments/attachment-123/url
```

Rules:

- Both endpoints require auth.
- Sync forwards to RBAC `AttachmentGrpc`.
- Mobile finalize callback remains direct mobile -> RBAC HTTP, not through Sync.

## Implementation Changes

Create `src/grpc/AttachmentClient.ts`:

- `presign(request, user): Promise<PresignResult>`.
- `getDownloadUrl(attachmentId, user): Promise<DownloadUrlResult>`.
- Map gRPC permission failures to 403.
- Map unavailable to 503.

Create `src/gateway/schemas/attachmentSchema.ts`.

Create `src/gateway/routes/attachment.ts`:

- `POST /sync/attachments/presign`.
- `GET /sync/attachments/:id/url`.
- Validate sizes and content type.
- Forward request context to RBAC.

## Error Handling

- Invalid body returns 400.
- RBAC permission denied returns 403.
- RBAC unavailable returns 503.
- Sync must not expose internal gRPC stack traces to clients.

## Test Plan

Add `tests/unit/attachmentRoute.test.ts`:

- Presign forwards expected request to client.
- Download URL forwards attachment id.
- Invalid body returns 400.
- Permission denied maps to 403.
- Unavailable maps to 503.

## Acceptance Criteria

- Sync never talks to MinIO directly.
- RBAC remains authoritative for attachment access.
- `npm run build` passes.
- `npm run test` passes.

## Follow-Up Specs

- `SPEC-015`: Production hardening and operations.
