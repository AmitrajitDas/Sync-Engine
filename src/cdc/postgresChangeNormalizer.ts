import { isDeepStrictEqual } from "node:util";
/*
 * Debezium/Postgres -> Sync Engine change mapper.
 *
 * Debezium describes database mutations as before/after row envelopes. The rest
 * of the service wants collection/docId/operation/bucket/delta entries, so this
 * module is the translation layer between database CDC and sync protocol terms.
 */
import type { NormalizedChangeEvent } from "../eventbus/EventBus.js";
import type { OplogOperation } from "../oplog/oplogSchema.js";
import { COLLECTION_BUCKETS } from "./bucketStrategy.js";

export interface DebeziumEnvelope {
  op: "c" | "u" | "d" | "r";
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  source?: {
    lsn?: string | number;
    [key: string]: unknown;
  };
  ts_ms?: number;
}

export interface CdcMetadata {
  sourceTopic: string;
  offset?: string;
}

function computeDelta(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const delta: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    // SPEC-028 — deep-equal so nested objects don't show as changed every update.
    if (!isDeepStrictEqual(before[key], after[key])) {
      delta[key] = after[key];
    }
  }
  return delta;
}

function buildCdcEventId(
  topic: string,
  offset: string | undefined,
  lsn: string | undefined,
  clientId: string | undefined,
  clientSeq: number | undefined,
): string | undefined {
  if (topic && offset != null) return `${topic}:${offset}`;
  if (lsn) return `lsn:${lsn}`;
  if (clientId && clientSeq != null) return `client:${clientId}:${clientSeq}`;
  return undefined;
}

export function normalizeDebeziumEnvelope(
  envelope: DebeziumEnvelope,
  collection: string,
  meta: CdcMetadata,
): NormalizedChangeEvent {
  const { op, before, after, source } = envelope;

  let operation: OplogOperation;
  switch (op) {
    case "c":
    case "r":
      operation = "PUT";
      break;
    case "u":
      operation = "PATCH";
      break;
    case "d":
      operation = "REMOVE";
      break;
    default:
      throw new Error(`Unsupported Debezium op: "${op}" in topic "${meta.sourceTopic}"`);
  }

  const activeRow = operation === "REMOVE" ? before : after;
  if (!activeRow) {
    throw new Error(
      `Missing row data for op "${op}" in topic "${meta.sourceTopic}"`,
    );
  }

  const docId = activeRow.id;
  const tenantId = activeRow.tenant_id;

  if (!docId) {
    throw new Error(`Missing "id" in CDC row for topic "${meta.sourceTopic}"`);
  }
  if (!tenantId) {
    throw new Error(`Missing "tenant_id" in CDC row for topic "${meta.sourceTopic}"`);
  }

  // Bucket derivation is intentionally collection-aware. Region-scoped data and
  // user-scoped data land in different buckets so clients only pull what they
  // are allowed to see.
  const strategy = COLLECTION_BUCKETS[collection];
  if (!strategy) {
    throw new Error(`No bucket strategy for collection: ${collection}`);
  }

  let bucket: string;
  if (strategy.group === "by_region") {
    const region = activeRow.region;
    if (!region) {
      throw new Error(
        `Missing "region" in CDC row for "${collection}" (topic "${meta.sourceTopic}")`,
      );
    }
    bucket = `tenant:${tenantId}:region:${region}`;
  } else {
    const field = strategy.userIdField!;
    const userId = activeRow[field];
    if (!userId) {
      throw new Error(
        `Missing "${field}" in CDC row for "${collection}" (topic "${meta.sourceTopic}")`,
      );
    }
    bucket = `tenant:${tenantId}:user:${userId}`;
  }

  // Client-originated writes are applied by the business service, then return
  // through CDC. Preserving client_id/client_seq lets clients identify their
  // own acknowledged writes when they later appear in the oplog.
  let clientId: string | undefined;
  let clientSeq: number | undefined;
  let origin: "server" | "client" = "server";

  const rawClientId = activeRow.client_id;
  const rawClientSeq = activeRow.client_seq;
  if (rawClientId && rawClientSeq != null && rawClientSeq !== "") {
    const parsedSeq = Number(rawClientSeq);
    if (Number.isFinite(parsedSeq)) {
      clientId = String(rawClientId);
      clientSeq = parsedSeq;
      origin = "client";
    }
  }

  let delta: Record<string, unknown> | null;
  let fullDoc: Record<string, unknown> | undefined;

  if (operation === "REMOVE") {
    delta = null;
  } else if (operation === "PATCH" && before && after) {
    delta = computeDelta(before, after);
    fullDoc = after;
  } else {
    delta = { ...after! };
    fullDoc = { ...after! };
  }

  const lsn = source?.lsn != null ? String(source.lsn) : undefined;
  const cdcEventId = buildCdcEventId(
    meta.sourceTopic,
    meta.offset,
    lsn,
    clientId,
    clientSeq,
  );

  return {
    collection,
    docId: String(docId),
    operation,
    delta,
    fullDoc,
    bucket,
    tenantId: String(tenantId),
    timestamp: new Date(),
    origin,
    clientId,
    clientSeq,
    cdcSourceTopic: meta.sourceTopic,
    cdcLsn: lsn,
    cdcOffset: meta.offset,
    cdcEventId,
  };
}
