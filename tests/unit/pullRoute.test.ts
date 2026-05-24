import { describe, it, expect, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { errorHandlerPlugin } from "../../src/gateway/plugins/errorHandler.js";
import { pullRoutes } from "../../src/gateway/routes/pull.js";
import type { OplogService } from "../../src/oplog/oplogService.js";
import type { OplogEntry } from "../../src/oplog/oplogSchema.js";
import type { SyncUser } from "../../src/gateway/types.js";
import { ObjectId } from "mongodb";

const USER: SyncUser = {
  sub: "u1",
  tenantId: "t1",
  tenantSlug: "t1",
  region: "north",
  roles: ["field_agent"],
};

function entry(seq: number, collection = "farms"): OplogEntry {
  return {
    _id: new ObjectId(),
    seq,
    timestamp: new Date("2024-01-01T00:00:00Z"),
    collection,
    docId: `d${seq}`,
    operation: "PUT",
    delta: { name: `n${seq}` },
    bucket: "tenant:t1:region:north",
    tenantId: "t1",
    origin: "server",
  };
}

async function buildPullApp(oplog: OplogService): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);
  app.addHook("preHandler", async (req) => {
    req.user = USER;
    req.buckets = ["tenant:t1:region:north", "tenant:t1:user:u1"];
  });
  await app.register(pullRoutes, { oplogService: oplog, defaultLimit: 500, maxLimit: 1000 });
  await app.ready();
  return app;
}

describe("POST /sync/pull", () => {
  it("passes collections filter into getEntriesAfter", async () => {
    const getEntriesAfter = vi.fn().mockResolvedValue([entry(1), entry(2)]);
    const app = await buildPullApp({ getEntriesAfter } as unknown as OplogService);

    await app.inject({
      method: "POST",
      url: "/sync/pull",
      payload: { checkpoint: 0, collections: ["farms"], limit: 100 },
    });

    const callArgs = getEntriesAfter.mock.calls[0];
    expect(callArgs[2]).toMatchObject({ collections: ["farms"] });
    await app.close();
  });

  it("advances checkpoint to raw max seq fetched", async () => {
    const getEntriesAfter = vi.fn().mockResolvedValue([entry(10), entry(20), entry(30)]);
    const app = await buildPullApp({ getEntriesAfter } as unknown as OplogService);

    const res = await app.inject({
      method: "POST",
      url: "/sync/pull",
      payload: { checkpoint: 0, limit: 100 },
    });
    expect(res.json().checkpoint).toBe(30);
    await app.close();
  });

  it("rejects negative priorityMax", async () => {
    const app = await buildPullApp({
      getEntriesAfter: vi.fn().mockResolvedValue([]),
    } as unknown as OplogService);
    const res = await app.inject({
      method: "POST",
      url: "/sync/pull",
      payload: { priorityMax: -1 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("orders entries by (priority asc, seq asc)", async () => {
    // farms = by_region prio 10, invoices = by_user prio 20
    const getEntriesAfter = vi
      .fn()
      .mockResolvedValue([entry(3, "invoices"), entry(1, "farms"), entry(2, "farms")]);
    const app = await buildPullApp({ getEntriesAfter } as unknown as OplogService);
    const res = await app.inject({
      method: "POST",
      url: "/sync/pull",
      payload: { checkpoint: 0, limit: 100 },
    });
    const seqs = res.json().entries.map((e: { seq: number }) => e.seq);
    expect(seqs).toEqual([1, 2, 3]);
    await app.close();
  });
});
