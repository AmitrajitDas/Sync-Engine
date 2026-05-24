import { pullRules, writeRules } from "./syncRules.js";
import type { WriteRequest } from "./syncTypes.js";
import type { ClientOperation } from "./syncRegistry.js";
import type { SyncUser } from "../gateway/types.js";
import type { OplogEntry } from "../oplog/oplogSchema.js";
import { ValidationError } from "../gateway/plugins/errorHandler.js";

export interface ProjectedEntry {
  seq: number;
  collection: string;
  docId: string;
  operation: OplogEntry["operation"];
  delta: Record<string, unknown> | null;
  fullDoc?: Record<string, unknown>;
  bucket: string;
  tenantId: string;
  timestamp: Date;
  priority?: number;
}

export interface CleanedWrite {
  collection: string;
  docId: string;
  operation: ClientOperation;
  payload: Record<string, unknown>;
  clientTimestamp: string;
  baseSeq: number;
  clientSeq: number;
  idempotencyKey: string;
}

function filterFields(
  obj: Record<string, unknown> | undefined,
  allowedFields: string[] | undefined,
): Record<string, unknown> | undefined {
  if (!obj || !allowedFields) return obj;
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => allowedFields.includes(k)),
  );
}

export function projectFields(entry: OplogEntry): ProjectedEntry {
  const rule = pullRules[entry.collection];
  const allowed = rule?.allowedFields;

  return {
    seq: entry.seq,
    collection: entry.collection,
    docId: entry.docId,
    operation: entry.operation,
    delta: entry.delta
      ? (filterFields(entry.delta as Record<string, unknown>, allowed) ?? null)
      : null,
    fullDoc: filterFields(entry.fullDoc as Record<string, unknown> | undefined, allowed),
    bucket: entry.bucket,
    tenantId: entry.tenantId,
    timestamp: entry.timestamp,
    priority: rule?.priority,
  };
}

const CLIENT_OPS: ReadonlySet<string> = new Set(["PUT", "PATCH", "REMOVE"]);

export function validateWrite(write: WriteRequest, user: SyncUser): CleanedWrite {
  const rule = writeRules[write.collection];
  if (!rule) {
    throw new ValidationError(`Unknown collection: ${write.collection}`);
  }

  if (!CLIENT_OPS.has(write.operation)) {
    throw new ValidationError(`client cannot emit ${write.operation}`);
  }

  const hasRole = user.roles.some((r) => rule.allowedRoles.includes(r));
  if (!hasRole) {
    throw new ValidationError(
      `Role not allowed to write to ${write.collection}. Required: ${rule.allowedRoles.join(", ")}`,
    );
  }

  if (!rule.allowedOps.includes(write.operation)) {
    throw new ValidationError(
      `Operation "${write.operation}" not allowed on ${write.collection}`,
    );
  }

  if (rule.ownershipField) {
    const owner = write.payload[rule.ownershipField];
    if (owner && owner !== user.sub && !user.roles.includes("tenant_admin")) {
      throw new ValidationError(`Ownership check failed for ${write.collection}`);
    }
  }

  const cleanedPayload = { ...write.payload };
  for (const field of rule.protectedFields) {
    delete cleanedPayload[field];
  }

  return { ...write, payload: cleanedPayload };
}
