import { describe, it, expect } from "vitest";
import { setMonotonic, type CheckpointCacheStore } from "../../src/oplog/checkpointCache.js";

class MemStore implements CheckpointCacheStore {
  private readonly m = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.m.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<unknown> {
    this.m.set(key, value);
    return "OK";
  }
}

describe("setMonotonic", () => {
  it("sets the value when key is empty", async () => {
    const store = new MemStore();
    await setMonotonic(store, "k", 5);
    expect(await store.get("k")).toBe("5");
  });

  it("never regresses regardless of write order", async () => {
    const store = new MemStore();
    await Promise.all([
      setMonotonic(store, "k", 100),
      setMonotonic(store, "k", 99),
      setMonotonic(store, "k", 101),
    ]);
    expect(Number(await store.get("k"))).toBe(101);
  });

  it("ignores a lower incoming value", async () => {
    const store = new MemStore();
    await setMonotonic(store, "k", 50);
    await setMonotonic(store, "k", 10);
    expect(await store.get("k")).toBe("50");
  });
});
