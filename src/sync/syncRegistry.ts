// SPEC-035 — single source of truth for per-collection sync config.
// pullRules, writeRules, COLLECTION_BUCKETS, LWW_COLLECTIONS, BUCKET_GROUPS
// are all derived from this registry.

export type BucketGroup = "by_region" | "by_user";
export type ClientOperation = "PUT" | "PATCH" | "REMOVE";
export type ConflictStrategyName = "lastWriteWins" | "serverWins";

export interface CollectionConfig {
  name: string;
  bucket: {
    group: BucketGroup;
    userIdField?: string;
    priority?: number;
  };
  pull: {
    allowedFields?: string[];
  };
  write: {
    allowedRoles: string[];
    allowedOps: ClientOperation[];
    protectedFields: string[];
    ownershipField?: string;
  };
  conflict: ConflictStrategyName;
}

// SPEC-033: bucket-group default priorities (smaller = higher priority).
export const BUCKET_GROUP_PRIORITY: Record<BucketGroup, number> = {
  by_region: 10,
  by_user: 20,
};

// Note: SPEC-030 item 1 — `farms.write.protectedFields` intentionally omits
// `region` so a region-based ownership check can be layered later without a
// double-protect collision.
export const COLLECTIONS: Record<string, CollectionConfig> = {
  farms: {
    name: "farms",
    bucket: { group: "by_region" },
    pull: {},
    write: {
      allowedRoles: ["field_agent", "tenant_admin"],
      allowedOps: ["PUT", "PATCH"],
      protectedFields: ["tenant_id", "created_at"],
      ownershipField: "created_by",
    },
    conflict: "lastWriteWins",
  },
  plots: {
    name: "plots",
    bucket: { group: "by_region" },
    pull: {},
    write: {
      allowedRoles: ["field_agent", "tenant_admin"],
      allowedOps: ["PUT", "PATCH", "REMOVE"],
      protectedFields: ["tenant_id", "region", "created_at"],
      ownershipField: "created_by",
    },
    conflict: "lastWriteWins",
  },
  crops: {
    name: "crops",
    bucket: { group: "by_region" },
    pull: {},
    write: {
      allowedRoles: ["field_agent", "tenant_admin"],
      allowedOps: ["PUT", "PATCH", "REMOVE"],
      protectedFields: ["tenant_id", "region", "created_at"],
    },
    conflict: "lastWriteWins",
  },
  action_events: {
    name: "action_events",
    bucket: { group: "by_region" },
    pull: {},
    write: {
      allowedRoles: ["field_agent", "tenant_admin"],
      allowedOps: ["PUT"],
      protectedFields: ["tenant_id", "region", "created_at", "seq"],
    },
    conflict: "serverWins",
  },
  inspections: {
    name: "inspections",
    bucket: { group: "by_region" },
    pull: {},
    write: {
      allowedRoles: ["field_agent", "tenant_admin"],
      allowedOps: ["PUT", "PATCH"],
      protectedFields: ["tenant_id", "region", "created_at"],
      ownershipField: "inspector_id",
    },
    conflict: "serverWins",
  },
  gdc_submissions: {
    name: "gdc_submissions",
    bucket: { group: "by_region" },
    pull: {},
    write: {
      allowedRoles: ["field_agent", "tenant_admin"],
      allowedOps: ["PUT", "PATCH"],
      protectedFields: ["tenant_id", "region", "created_at", "status"],
    },
    conflict: "lastWriteWins",
  },
  invoices: {
    name: "invoices",
    bucket: { group: "by_user", userIdField: "user_id" },
    pull: {},
    write: {
      allowedRoles: ["tenant_admin"],
      allowedOps: ["PUT", "PATCH"],
      protectedFields: ["tenant_id", "created_at", "paid_at"],
    },
    conflict: "serverWins",
  },
  farm_members: {
    name: "farm_members",
    bucket: { group: "by_user", userIdField: "user_id" },
    pull: {},
    write: {
      allowedRoles: ["tenant_admin"],
      allowedOps: ["PUT", "PATCH", "REMOVE"],
      protectedFields: ["tenant_id", "created_at"],
      ownershipField: "farm_id",
    },
    conflict: "serverWins",
  },
  attachments: {
    name: "attachments",
    bucket: { group: "by_user", userIdField: "uploaded_by" },
    pull: {},
    write: {
      allowedRoles: ["field_agent", "tenant_admin"],
      allowedOps: ["PUT", "REMOVE"],
      protectedFields: ["tenant_id", "created_at", "storage_path"],
      ownershipField: "uploaded_by",
    },
    conflict: "serverWins",
  },
};

export function effectivePriority(c: CollectionConfig): number {
  return c.bucket.priority ?? BUCKET_GROUP_PRIORITY[c.bucket.group];
}

function validateRegistry(): void {
  for (const [name, c] of Object.entries(COLLECTIONS)) {
    if (c.name !== name) {
      throw new Error(`Registry key mismatch: "${name}" vs c.name="${c.name}"`);
    }
    if (c.bucket.group === "by_user" && !c.bucket.userIdField) {
      throw new Error(
        `Collection "${name}" uses by_user bucket but has no bucket.userIdField`,
      );
    }
    if (
      c.conflict === "lastWriteWins" &&
      c.write.allowedOps.length === 1 &&
      c.write.allowedOps[0] === "REMOVE"
    ) {
      // eslint-disable-next-line no-console
      console.warn(
        `Collection "${name}" uses lastWriteWins but only allows REMOVE; no merge possible`,
      );
    }
  }
}
validateRegistry();
