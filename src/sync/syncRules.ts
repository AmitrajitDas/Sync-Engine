/*
 * Derived compatibility surface for code that expects pull/write rules.
 *
 * Do not edit policy here. Change syncRegistry instead, then these objects will
 * reflect the new collection behavior automatically.
 */
import { COLLECTIONS, effectivePriority, type ClientOperation } from "./syncRegistry.js";

export interface PullRule {
  allowedFields?: string[];
  bucketGroup: "by_region" | "by_user";
  priority?: number;
}

export interface WriteRule {
  allowedRoles: string[];
  allowedOps: ClientOperation[];
  protectedFields: string[];
  ownershipField?: string;
}

function derivePullRules(): Record<string, PullRule> {
  const out: Record<string, PullRule> = {};
  for (const [name, c] of Object.entries(COLLECTIONS)) {
    out[name] = {
      allowedFields: c.pull.allowedFields,
      bucketGroup: c.bucket.group,
      priority: effectivePriority(c),
    };
  }
  return out;
}

function deriveWriteRules(): Record<string, WriteRule> {
  const out: Record<string, WriteRule> = {};
  for (const [name, c] of Object.entries(COLLECTIONS)) {
    out[name] = {
      allowedRoles: c.write.allowedRoles,
      allowedOps: c.write.allowedOps,
      protectedFields: c.write.protectedFields,
      ownershipField: c.write.ownershipField,
    };
  }
  return out;
}

export const pullRules: Record<string, PullRule> = derivePullRules();
export const writeRules: Record<string, WriteRule> = deriveWriteRules();
