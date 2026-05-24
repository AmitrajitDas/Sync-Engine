import { describe, it, expect } from "vitest";
import {
  resolveBuckets,
  resolveBucketsWithPriority,
  bucketMatchesUser,
} from "../../src/buckets/bucketResolver.js";
import type { SyncUser } from "../../src/gateway/types.js";

const BASE_USER: SyncUser = {
  sub: "user-1",
  tenantId: "tenant-1",
  tenantSlug: "t1",
  region: "north",
  roles: ["field_agent"],
};

describe("resolveBuckets", () => {
  it("returns region and user buckets for regular user", () => {
    const buckets = resolveBuckets(BASE_USER);
    expect(buckets).toContain("tenant:tenant-1:region:north");
    expect(buckets).toContain("tenant:tenant-1:user:user-1");
    expect(buckets).not.toContain("tenant:tenant-1:*");
  });

  it("adds wildcard bucket for tenant_admin", () => {
    const admin = { ...BASE_USER, roles: ["tenant_admin"] };
    const buckets = resolveBuckets(admin);
    expect(buckets).toContain("tenant:tenant-1:*");
  });
});

describe("resolveBucketsWithPriority", () => {
  it("assigns by_region priority 10 and by_user priority 20", () => {
    const out = resolveBucketsWithPriority(BASE_USER);
    const region = out.find((b) => b.group === "by_region");
    const user = out.find((b) => b.group === "by_user");
    expect(region?.priority).toBe(10);
    expect(user?.priority).toBe(20);
  });
});

describe("bucketMatchesUser", () => {
  it("matches exact bucket", () => {
    const userBuckets = resolveBuckets(BASE_USER);
    expect(bucketMatchesUser("tenant:tenant-1:region:north", userBuckets)).toBe(true);
  });

  it("rejects bucket from different tenant", () => {
    const userBuckets = resolveBuckets(BASE_USER);
    expect(bucketMatchesUser("tenant:other:region:north", userBuckets)).toBe(false);
  });

  it("admin wildcard matches any bucket for same tenant", () => {
    const admin = { ...BASE_USER, roles: ["tenant_admin"] };
    const userBuckets = resolveBuckets(admin);
    expect(bucketMatchesUser("tenant:tenant-1:region:south", userBuckets)).toBe(true);
  });
});
