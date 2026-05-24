# ADR-001: Postgres as source of truth; MongoDB as append-only oplog

**Status:** Accepted

## Decision

RBAC owns Postgres (business data, strong consistency). Sync owns MongoDB (oplog only). Sync never writes to Postgres directly.

## Reasoning

- Postgres gives ACID, foreign keys, and authoritative state for business data.
- MongoDB's flexible documents and TTL indexes make it ideal for an append-only oplog with bucket filtering.
- Separation prevents Sync from becoming a write path for business data.

## Consequences

- MongoDB entries expire after `OPLOG_TTL_DAYS` (default 30). Clients absent longer than TTL must use the snapshot endpoint.
- Sync cannot reconstruct current state without replaying all oplog entries or querying RBAC.
