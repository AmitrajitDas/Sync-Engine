import { describe, it, expect, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { SubscriptionRegistry } from "../../src/realtime/subscriptionRegistry.js";
import type { OplogService } from "../../src/oplog/oplogService.js";

function makeOplog(latestSeq = 0): OplogService {
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

describe("GET /sync/subscribe — route mounting", () => {
  it("not mounted without auth config", async () => {
    const app = await buildApp({ LOG_LEVEL: "silent" });
    await app.ready();
    // HTTP GET to WS-only route → 404 when not mounted
    const res = await app.inject({ method: "GET", url: "/sync/subscribe" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("not mounted without oplogService — auth hook fires first (401 not 404)", async () => {
    // Auth onRequest hook is global (fp-wrapped) — fires even for un-mounted routes.
    // Cannot distinguish "route missing" from "auth rejected" via status code here;
    // confirm we get a 4xx, not a 2xx success.
    const app = await buildApp({
      LOG_LEVEL: "silent",
      JWKS_URL: "http://jwks.local/.well-known/jwks.json",
      JWT_ISSUER: "test",
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/sync/subscribe" });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });

  it("not mounted without subscriptionRegistry — auth hook fires first (401 not 404)", async () => {
    const app = await buildApp(
      {
        LOG_LEVEL: "silent",
        JWKS_URL: "http://jwks.local/.well-known/jwks.json",
        JWT_ISSUER: "test",
      },
      { oplogService: makeOplog() },
    );
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/sync/subscribe" });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });

  it("mounted when auth + oplogService + registry all present", async () => {
    const app = await buildApp(
      {
        LOG_LEVEL: "silent",
        JWKS_URL: "http://jwks.local/.well-known/jwks.json",
        JWT_ISSUER: "test",
      },
      {
        oplogService: makeOplog(),
        subscriptionRegistry: new SubscriptionRegistry(),
      },
    );
    await app.ready();
    // Route exists; HTTP GET without Upgrade header gets rejected but not 404
    const res = await app.inject({ method: "GET", url: "/sync/subscribe" });
    expect(res.statusCode).not.toBe(404);
    await app.close();
  });
});

describe("SubscriptionRegistry — session tracking", () => {
  it("addSession / removeSession update sessionCount", () => {
    const registry = new SubscriptionRegistry();
    const mockSession = {
      buckets: new Set(["tenant:t1:region:north"]),
      close: vi.fn(),
    } as never;
    registry.addSession(mockSession);
    expect(registry.sessionCount()).toBe(1);
    registry.removeSession(mockSession);
    expect(registry.sessionCount()).toBe(0);
  });

  it("deliverToSessions returns sessions for matching bucket", () => {
    const registry = new SubscriptionRegistry();
    const session = {
      buckets: new Set(["tenant:t1:region:north"]),
      close: vi.fn(),
    } as never;
    registry.addSession(session);
    const result = registry.deliverToSessions("tenant:t1:region:north", 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(session);
  });

  it("deliverToSessions returns empty for unmatched bucket", () => {
    const registry = new SubscriptionRegistry();
    const session = {
      buckets: new Set(["tenant:t1:region:north"]),
      close: vi.fn(),
    } as never;
    registry.addSession(session);
    const result = registry.deliverToSessions("tenant:t2:region:south", 1);
    expect(result).toHaveLength(0);
  });
});
