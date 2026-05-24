import { describe, it, expect } from "vitest";
import { hashEntry, BucketChecksum, type ChecksumStore } from "../../src/oplog/bucketChecksum.js";
import type { OplogEntry } from "../../src/oplog/oplogSchema.js";
import { ObjectId } from "mongodb";

function entry(seq: number): OplogEntry {
  return {
    _id: new ObjectId(),
    seq,
    timestamp: new Date(),
    collection: "farms",
    docId: `f${seq}`,
    operation: "PUT",
    delta: { name: `n${seq}` },
    bucket: "tenant:t1:region:north",
    tenantId: "t1",
    origin: "server",
  };
}

class MemChecksumStore implements ChecksumStore {
  private readonly h = new Map<string, Map<string, string>>();
  async hget(key: string, field: string): Promise<string | null> {
    return this.h.get(key)?.get(field) ?? null;
  }
  async hset(key: string, field: string, value: string): Promise<unknown> {
    if (!this.h.has(key)) this.h.set(key, new Map());
    this.h.get(key)!.set(field, value);
    return 1;
  }
}

describe("bucketChecksum", () => {
  it("hashEntry is deterministic", () => {
    expect(hashEntry(entry(1))).toBe(hashEntry(entry(1)));
  });

  it("hashEntry differs for different entries", () => {
    expect(hashEntry(entry(1))).not.toBe(hashEntry(entry(2)));
  });

  it("update accumulates additively across sequential entries", async () => {
    const bc = new BucketChecksum(new MemChecksumStore());
    let last = { seq: 0, csum: 0 };
    for (let s = 1; s <= 5; s++) {
      last = await bc.update("b", entry(s));
    }
    const expected =
      [1, 2, 3, 4, 5].reduce((acc, s) => (acc + hashEntry(entry(s))) % 0x1_0000_0000, 0);
    expect(last.seq).toBe(5);
    expect(last.csum).toBe(expected);
  });

  it("get returns null for unknown bucket", async () => {
    const bc = new BucketChecksum(new MemChecksumStore());
    expect(await bc.get("missing")).toBeNull();
  });

  it("update ignores a stale (lower-seq) entry", async () => {
    const bc = new BucketChecksum(new MemChecksumStore());
    await bc.update("b", entry(5));
    const after = await bc.update("b", entry(3));
    expect(after.seq).toBe(5);
  });
});
