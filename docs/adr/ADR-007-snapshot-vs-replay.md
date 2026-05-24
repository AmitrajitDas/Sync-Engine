# ADR-007: Snapshot endpoint for stale clients

**Status:** Accepted

## Decision

Clients at checkpoint 0 or whose required history exceeds the oplog TTL must call `GET /sync/snapshot` to bootstrap. Replay from seq=0 is not supported.

## Reasoning

- Oplog TTL (30 days) keeps MongoDB size bounded. Unbounded replay would require indefinite retention.
- Snapshot streams current Postgres state via `SnapshotReader`; clients can then resume from `snapshotSeq` via normal pull.

## Consequences

- Snapshot endpoint has its own rate limit (5/min/user).
- `SnapshotReader` implementation must be provided at startup; Sync does not own the Postgres schema.
