# ADR-006: Field-level last-write-wins conflict resolution

**Status:** Accepted

## Decision

For farms, plots, crops, and gdc_submissions: resolve conflicts at field granularity using `_meta.field_timestamps`. For all other collections: server wins.

## Reasoning

- Field-level LWW allows two offline agents to edit different fields of the same farm record without conflict.
- Server-wins for transactional records (invoices, action_events) preserves server authority where partial merges would be semantically incorrect.

## Consequences

- Clients must send `_meta.field_timestamps` with each update payload.
- Missing or malformed timestamps fall back to server-wins.
- RBAC remains authoritative — Sync pre-flight is an optimization only.
