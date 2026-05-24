import { describe, it, expect, vi } from "vitest";
import { ConflictResolver } from "../../src/conflicts/conflictResolver.js";
import type { OplogService } from "../../src/oplog/oplogService.js";
import type { WriteRequest } from "../../src/sync/syncTypes.js";
import { ObjectId } from "mongodb";

const WRITE: WriteRequest = {
  collection: "farms",
  docId: "farm-1",
  operation: "PATCH",
  payload: { name: "Client" },
  clientTimestamp: "2024-01-01T11:00:00Z",
  baseSeq: 0,
  clientSeq: 1,
  idempotencyKey: "k1",
};

describe("ConflictResolver", () => {
  it("performs a single bounded getLatestForDocument lookup", async () => {
    const getLatest = vi.fn().mockResolvedValue(null);
    const oplog = { getLatestForDocument: getLatest } as unknown as OplogService;
    const resolver = new ConflictResolver(oplog);

    const result = await resolver.resolve(WRITE);

    expect(getLatest).toHaveBeenCalledOnce();
    expect(getLatest).toHaveBeenCalledWith("farms", "farm-1");
    expect(result.outcome).toBe("client_wins");
  });

  it("LWW merges against the single latest entry", async () => {
    const latest = {
      _id: new ObjectId(),
      seq: 5,
      timestamp: new Date("2024-01-01T09:00:00Z"),
      collection: "farms",
      docId: "farm-1",
      operation: "PATCH" as const,
      delta: null,
      fullDoc: { name: "Server", _meta: { updated_at: "2024-01-01T09:00:00Z" } },
      bucket: "tenant:t1:region:north",
      tenantId: "t1",
      origin: "server" as const,
    };
    const oplog = {
      getLatestForDocument: vi.fn().mockResolvedValue(latest),
    } as unknown as OplogService;
    const resolver = new ConflictResolver(oplog);

    const result = await resolver.resolve(WRITE);
    expect(result.outcome).toBe("merged");
    expect(result.payload).toHaveProperty("name", "Client");
  });
});
