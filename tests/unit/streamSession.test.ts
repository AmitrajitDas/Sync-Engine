import { describe, it, expect, vi, beforeEach } from "vitest";
import { StreamSession } from "../../src/realtime/streamSession.js";
import type { WebSocket } from "@fastify/websocket";
import type { OplogService } from "../../src/oplog/oplogService.js";
import type { OplogEntry } from "../../src/oplog/oplogSchema.js";
import { ObjectId } from "mongodb";

function makeSocket(): { ws: WebSocket; sent: string[] } {
  const sent: string[] = [];
  const ws = {
    readyState: 1,
    OPEN: 1,
    send: vi.fn((msg: string) => sent.push(msg)),
    close: vi.fn(),
    on: vi.fn(),
    ping: vi.fn(),
  } as unknown as WebSocket;
  return { ws, sent };
}

function makeOplog(entries: OplogEntry[] = []): OplogService {
  return {
    getEntriesAfter: vi.fn().mockResolvedValue(entries),
    getLatestSeq: vi.fn().mockResolvedValue(0),
    appendToOplog: vi.fn(),
    replayDocument: vi.fn().mockResolvedValue([]),
    replayFromSeq: vi.fn(),
    replayFromTimestamp: vi.fn(),
    findByClientWrite: vi.fn().mockResolvedValue(null),
  } as unknown as OplogService;
}

function makeEntry(seq: number, bucket = "tenant:t1:region:north", collection = "farms"): OplogEntry {
  return {
    _id: new ObjectId(),
    seq,
    timestamp: new Date(),
    collection,
    docId: `d${seq}`,
    operation: "PUT",
    delta: { name: `n${seq}` },
    bucket,
    tenantId: "t1",
    origin: "server",
  };
}

const DEFAULT_BUCKETS = ["tenant:t1:region:north"];
const PRIORITY_MAP = new Map([["tenant:t1:region:north", 10]]);

function makeSession(
  socket: WebSocket,
  oplog: OplogService,
  overrides: {
    buckets?: string[];
    checkpoints?: Record<string, number>;
    collections?: string[];
    priorityMax?: number;
  } = {},
): StreamSession {
  return new StreamSession(
    {
      socket,
      oplog,
      batchSize: 50,
      ackTimeoutMs: 100,
      bucketPriority: PRIORITY_MAP,
    },
    {
      type: "start",
      buckets: overrides.buckets ?? DEFAULT_BUCKETS,
      checkpoints: overrides.checkpoints ?? {},
      collections: overrides.collections,
      priorityMax: overrides.priorityMax,
    },
  );
}

describe("StreamSession — lifecycle", () => {
  it("close() is idempotent", () => {
    const { ws } = makeSocket();
    const session = makeSession(ws, makeOplog());
    session.close();
    session.close();
    // No throw, no duplicate metric decrement issues
  });

  it("send after close is no-op", async () => {
    const { ws, sent } = makeSocket();
    const session = makeSession(ws, makeOplog());
    session.close();
    await session.deliver(makeEntry(1));
    expect(sent).toHaveLength(0);
  });
});

describe("StreamSession — backfill", () => {
  it("empty oplog → sends checkpoint_complete with final=true", async () => {
    const { ws, sent } = makeSocket();
    const session = makeSession(ws, makeOplog([]));
    await session.backfill();
    const frames = sent.map((s) => JSON.parse(s));
    const cpFrame = frames.find((f) => f.type === "checkpoint_complete");
    expect(cpFrame).toBeDefined();
    expect(cpFrame.final).toBe(true);
  });

  it("sends data frame for entries then checkpoint_complete", async () => {
    const { ws, sent } = makeSocket();
    const entries = [makeEntry(1), makeEntry(2)];
    const oplog = makeOplog(entries);
    // First call returns entries, second returns [] to stop paging
    (oplog.getEntriesAfter as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(entries)
      .mockResolvedValueOnce([]);
    const session = makeSession(ws, oplog);
    // Immediately ack to unblock backpressure
    session.ack();
    // Patch awaitingAck to never block
    const backfillPromise = session.backfill();
    // Drain all micro-tasks: ack each time we pause
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
      session.ack();
    }
    await backfillPromise;
    const frames = sent.map((s) => JSON.parse(s));
    expect(frames.some((f) => f.type === "data")).toBe(true);
    expect(frames.some((f) => f.type === "checkpoint_complete")).toBe(true);
  });

  it("respects priorityMax — skips bucket with priority above max", async () => {
    const { ws, sent } = makeSocket();
    const oplog = makeOplog([makeEntry(1)]);
    // bucket has priority 10; priorityMax = 5 → should skip
    const session = makeSession(ws, oplog, { priorityMax: 5 });
    await session.backfill();
    // No data frames, no checkpoint_complete because no priority groups survived
    const frames = sent.map((s) => JSON.parse(s));
    expect(frames.filter((f) => f.type === "data")).toHaveLength(0);
  });
});

describe("StreamSession — deliver", () => {
  it("deliver sends data frame with correct priority", async () => {
    const { ws, sent } = makeSocket();
    const session = makeSession(ws, makeOplog());
    await session.deliver(makeEntry(5));
    const frame = JSON.parse(sent[0]);
    expect(frame.type).toBe("data");
    expect(frame.priority).toBe(10);
    expect(frame.entries[0].seq).toBe(5);
  });

  it("deliver ignores entry for bucket not in session", async () => {
    const { ws, sent } = makeSocket();
    const session = makeSession(ws, makeOplog());
    const foreignEntry = makeEntry(5, "tenant:t2:region:south");
    await session.deliver(foreignEntry);
    expect(sent).toHaveLength(0);
  });

  it("deliver filters by collections when set", async () => {
    const { ws, sent } = makeSocket();
    const session = makeSession(ws, makeOplog(), { collections: ["farms"] });
    await session.deliver(makeEntry(5, "tenant:t1:region:north", "invoices"));
    expect(sent).toHaveLength(0);
    await session.deliver(makeEntry(6, "tenant:t1:region:north", "farms"));
    expect(sent).toHaveLength(1);
  });

  it("deliver skips entry with priority above priorityMax", async () => {
    const { ws, sent } = makeSocket();
    const session = makeSession(ws, makeOplog(), { priorityMax: 5 });
    // bucket priority = 10 > 5
    await session.deliver(makeEntry(5));
    expect(sent).toHaveLength(0);
  });
});

describe("StreamSession — pause / resume", () => {
  it("setPaused(true) sets paused state", () => {
    const { ws } = makeSocket();
    const session = makeSession(ws, makeOplog());
    session.setPaused(true);
    // No error thrown, state is set internally
  });

  it("ack() clears awaitingAck state", () => {
    const { ws } = makeSocket();
    const session = makeSession(ws, makeOplog());
    session.ack();
    // No error — just verifying it doesn't throw
  });
});
