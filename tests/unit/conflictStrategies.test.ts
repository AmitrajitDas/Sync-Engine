import { describe, it, expect } from "vitest";
import { LastWriteWinsStrategy } from "../../src/conflicts/strategies/lastWriteWins.js";
import { ServerWinsStrategy } from "../../src/conflicts/strategies/serverWins.js";
import type { WriteRequest } from "../../src/sync/syncTypes.js";
import type { OplogEntry } from "../../src/oplog/oplogSchema.js";
import { ObjectId } from "mongodb";

function makeEntry(overrides: Partial<OplogEntry> = {}): OplogEntry {
  return {
    _id: new ObjectId(),
    seq: 1,
    timestamp: new Date("2024-01-01T10:00:00Z"),
    collection: "farms",
    docId: "farm-1",
    operation: "PATCH",
    delta: null,
    fullDoc: { id: "farm-1", name: "Server Name", _meta: { updated_at: "2024-01-01T09:00:00Z" } },
    bucket: "tenant:t1:region:north",
    tenantId: "t1",
    origin: "server",
    ...overrides,
  };
}

const WRITE: WriteRequest = {
  collection: "farms",
  docId: "farm-1",
  operation: "PATCH",
  payload: { name: "Client Name" },
  clientTimestamp: "2024-01-01T11:00:00Z",
  baseSeq: 0,
  clientSeq: 1,
  idempotencyKey: "k1",
};

describe("LastWriteWinsStrategy", () => {
  const lww = new LastWriteWinsStrategy();

  it("client wins when no server latest", () => {
    const result = lww.resolve({ write: WRITE, serverLatest: null });
    expect(result.outcome).toBe("client_wins");
    expect(result.payload).toEqual(WRITE.payload);
  });

  it("merges fields where client timestamp is newer", () => {
    const result = lww.resolve({ write: WRITE, serverLatest: makeEntry() });
    expect(result.outcome).toBe("merged");
    expect(result.payload).toHaveProperty("name", "Client Name");
  });

  it("server wins for field where server is newer", () => {
    const oldWrite = { ...WRITE, clientTimestamp: "2024-01-01T08:00:00Z" };
    const result = lww.resolve({ write: oldWrite, serverLatest: makeEntry() });
    expect(result.payload).toHaveProperty("name", "Server Name");
  });

  it("client REMOVE newer than server PATCH → client_wins tombstone", () => {
    const removeWrite: WriteRequest = {
      ...WRITE,
      operation: "REMOVE",
      payload: {},
      clientTimestamp: "2024-01-01T12:00:00Z",
    };
    const result = lww.resolve({ write: removeWrite, serverLatest: makeEntry() });
    expect(result.outcome).toBe("client_wins");
    expect(result.payload).toEqual({});
  });

  it("server REMOVE newer than client PATCH → server_wins", () => {
    const serverRemove = makeEntry({
      operation: "REMOVE",
      timestamp: new Date("2024-01-01T23:00:00Z"),
    });
    const result = lww.resolve({ write: WRITE, serverLatest: serverRemove });
    expect(result.outcome).toBe("server_wins");
  });
});

describe("ServerWinsStrategy", () => {
  const sw = new ServerWinsStrategy();

  it("client wins when no server latest", () => {
    const result = sw.resolve({ write: WRITE, serverLatest: null });
    expect(result.outcome).toBe("client_wins");
  });

  it("server wins when latest exists", () => {
    const result = sw.resolve({ write: WRITE, serverLatest: makeEntry() });
    expect(result.outcome).toBe("server_wins");
    expect(result.payload).toHaveProperty("name", "Server Name");
  });
});
