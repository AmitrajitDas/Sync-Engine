import { COLLECTIONS } from "../sync/syncRegistry.js";
/*
 * CDC bucket strategy derived from the sync registry.
 *
 * Keeping this derived avoids one class of bugs: a collection being pulled from
 * one bucket group while CDC writes it into another bucket group.
 */
import { pullRules } from "../sync/syncRules.js";

export interface CollectionBucketStrategy {
  group: "by_region" | "by_user";
  userIdField?: string;
}

function derive(): Record<string, CollectionBucketStrategy> {
  const out: Record<string, CollectionBucketStrategy> = {};
  for (const [name, c] of Object.entries(COLLECTIONS)) {
    out[name] = { group: c.bucket.group, userIdField: c.bucket.userIdField };
  }
  return out;
}

export const COLLECTION_BUCKETS: Record<string, CollectionBucketStrategy> = derive();

function assertRegistryAlignment(): void {
  for (const k of Object.keys(pullRules)) {
    if (pullRules[k].bucketGroup !== COLLECTION_BUCKETS[k]?.group) {
      throw new Error(
        `Bucket strategy mismatch for "${k}": pullRules=${pullRules[k].bucketGroup} buckets=${COLLECTION_BUCKETS[k]?.group}`,
      );
    }
  }
}
assertRegistryAlignment();
