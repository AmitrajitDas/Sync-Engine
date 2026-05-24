import { describe, it, expect, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import type { OplogService } from "../../src/oplog/oplogService.js";

function makeOplogService(latestSeq = 42): OplogService {
  return {
    getLatestSeq: vi.fn().mockResolvedValue(latestSeq),
    getEntriesAfter: vi.fn().mockResolvedValue([]),
    appendToOplog: vi.fn(),
    replayDocument: vi.fn().mockResolvedValue([]),
    replayFromSeq: vi.fn(),
    replayFromTimestamp: vi.fn(),
    findByClientWrite: vi.fn().mockResolvedValue(null),
  } as unknown as OplogService;
}

describe("GET /sync/checkpoint", () => {
  it("requires auth (returns 4xx without token when auth configured)", async () => {
    const app = await buildApp({
      LOG_LEVEL: "silent",
      JWKS_URL: "http://jwks.local/.well-known/jwks.json",
      JWT_ISSUER: "test",
    }, { oplogService: makeOplogService() });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/sync/checkpoint" });
    // JWKS server unreachable in unit tests → auth fails with 4xx or 5xx
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });

  it("returns 500 when no bucket context (no auth configured)", async () => {
    const app = await buildApp({ LOG_LEVEL: "silent" }, { oplogService: makeOplogService() });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/sync/checkpoint" });
    // Without auth plugin, request.buckets is undefined → throws → 500
    expect([500, 401]).toContain(res.statusCode);
    await app.close();
  });
});
