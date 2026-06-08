import type { SyncUser } from "../gateway/types.js";
/*
 * User -> sync bucket resolver.
 *
 * Buckets are the service's coarse-grained access partitions. Routes use these
 * bucket names to filter oplog reads and realtime subscriptions.
 */
import { BUCKET_GROUP_PRIORITY, type BucketGroup } from "../sync/syncRegistry.js";

export interface BucketWithPriority {
  bucket: string;
  priority: number;
  group: BucketGroup;
}

export function resolveBucketsWithPriority(user: SyncUser): BucketWithPriority[] {
  // Every user sees region-scoped data for their region and user-scoped data for
  // themselves. Tenant admins additionally get a wildcard tenant bucket.
  const out: BucketWithPriority[] = [
    {
      bucket: `tenant:${user.tenantId}:region:${user.region}`,
      priority: BUCKET_GROUP_PRIORITY.by_region,
      group: "by_region",
    },
    {
      bucket: `tenant:${user.tenantId}:user:${user.sub}`,
      priority: BUCKET_GROUP_PRIORITY.by_user,
      group: "by_user",
    },
  ];
  if (user.roles.includes("tenant_admin")) {
    out.push({
      bucket: `tenant:${user.tenantId}:*`,
      priority: BUCKET_GROUP_PRIORITY.by_region,
      group: "by_region",
    });
  }
  return out;
}

export function resolveBuckets(user: SyncUser): string[] {
  return resolveBucketsWithPriority(user).map((b) => b.bucket);
}

export function bucketMatchesUser(bucket: string, userBuckets: string[]): boolean {
  if (userBuckets.includes(bucket)) return true;

  const tenantMatch = /^tenant:([^:]+):/.exec(bucket);
  if (!tenantMatch) return false;
  const tenantId = tenantMatch[1];
  return userBuckets.includes(`tenant:${tenantId}:*`);
}
