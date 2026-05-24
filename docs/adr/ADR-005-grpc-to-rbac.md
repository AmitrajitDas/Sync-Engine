# ADR-005: gRPC for Sync → RBAC calls

**Status:** Accepted

## Decision

Use gRPC (`@grpc/grpc-js`) for all Sync → RBAC service calls (RbacCheck, BusinessProxy, AttachmentGrpc). Do not use HTTP/REST.

## Reasoning

- Proto contracts are strongly typed and version-controlled alongside service code.
- gRPC streaming supports future batch operations.
- Lower per-call overhead than HTTP/JSON for high-frequency authorization checks.

## Consequences

- Proto stubs must be regenerated after any proto change (`npm run proto:gen`).
- Circuit breaker (opossum) is required on all gRPC clients. UNAVAILABLE is retryable; PERMISSION_DENIED and INVALID_ARGUMENT are not.
