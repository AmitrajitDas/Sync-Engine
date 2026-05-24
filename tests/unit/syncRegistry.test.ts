import { describe, it, expect } from "vitest";
import { COLLECTIONS, effectivePriority } from "../../src/sync/syncRegistry.js";
import { pullRules, writeRules } from "../../src/sync/syncRules.js";
import { COLLECTION_BUCKETS } from "../../src/cdc/bucketStrategy.js";
import { LWW_COLLECTIONS } from "../../src/conflicts/conflictResolver.js";

describe("syncRegistry", () => {
  const expected = [
    "farms",
    "plots",
    "crops",
    "action_events",
    "inspections",
    "gdc_submissions",
    "invoices",
    "farm_members",
    "attachments",
  ];

  it("covers all known collections", () => {
    for (const c of expected) {
      expect(COLLECTIONS[c]).toBeDefined();
    }
  });

  it("every by_user collection has a userIdField", () => {
    for (const c of Object.values(COLLECTIONS)) {
      if (c.bucket.group === "by_user") {
        expect(c.bucket.userIdField).toBeTruthy();
      }
    }
  });

  it("derived pullRules.bucketGroup matches COLLECTION_BUCKETS", () => {
    for (const k of Object.keys(pullRules)) {
      expect(pullRules[k].bucketGroup).toBe(COLLECTION_BUCKETS[k].group);
    }
  });

  it("derived writeRules cover every registry collection", () => {
    for (const k of Object.keys(COLLECTIONS)) {
      expect(writeRules[k]).toBeDefined();
    }
  });

  it("LWW_COLLECTIONS matches registry conflict strategy", () => {
    for (const [k, c] of Object.entries(COLLECTIONS)) {
      expect(LWW_COLLECTIONS.has(k)).toBe(c.conflict === "lastWriteWins");
    }
  });

  it("effectivePriority falls back to bucket-group default", () => {
    expect(effectivePriority(COLLECTIONS.farms)).toBe(10);
    expect(effectivePriority(COLLECTIONS.invoices)).toBe(20);
  });

  it("farms protectedFields omits region (SPEC-030 #1)", () => {
    expect(writeRules.farms.protectedFields).not.toContain("region");
  });
});
