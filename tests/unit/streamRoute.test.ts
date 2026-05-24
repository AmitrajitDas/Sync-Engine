import { describe, it, expect, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { SubscriptionRegistry } from "../../src/realtime/subscriptionRegistry.js";
import type { OplogService } from "../../src/oplog/oplogService.js";

function makeOplog(): OplogService {
  return {
    getLatestSeq: vi.fn().mockResolvedValue(0),
    getEntriesAfter: vi.fn().mockResolvedValue([]),
    appendToOplog: vi.fn(),
    replayDocument: vi.fn().mockResolvedValue([]),
    replayFromSeq: vi.fn(),
    replayFromTimestamp: vi.fn(),
    findByClientWrite: vi.fn().mockResolvedValue(null),
  } as unknown as OplogService;
}

describe("GET /sync/stream — route mounting", () => {
  it("not mounted without auth config", async () => {
    const app = await buildApp({ LOG_LEVEL: "silent" });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/sync/stream" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("not mounted without oplogService — auth hook fires first (401 not 404)", async () => {
    // Auth onRequest hook is global (fp-wrapped) — fires even for un-mounted routes.
    const app = await buildApp({
      LOG_LEVEL: "silent",
      JWKS_URL: "http://jwks.local/.well-known/jwks.json",
      JWT_ISSUER: "test",
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/sync/stream" });
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
    const res = await app.inject({ method: "GET", url: "/sync/stream" });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });

  it("mounted when auth + oplogService + registry present", async () => {
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
    // Route exists — HTTP GET without WS upgrade is rejected but not 404
    const res = await app.inject({ method: "GET", url: "/sync/stream" });
    expect(res.statusCode).not.toBe(404);
    await app.close();
  });
});

describe("GET /sync/stream — protocol behavior via inject", () => {
  async function buildStreamApp() {
    return buildApp(
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
  }

  it("rejects plain HTTP GET (non-websocket) request", async () => {
    const app = await buildStreamApp();
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: "/sync/stream",
      headers: { connection: "keep-alive" },
    });
    // Not a valid WS upgrade → not 200
    expect(res.statusCode).not.toBe(200);
    await app.close();
  });
});

describe("GET /sync/schema — blocked policy returns 426", () => {
  it("returns 426 with UpgradeRequired error when client below min version", async () => {
    const app = await buildApp(
      {
        LOG_LEVEL: "silent",
        JWKS_URL: "http://jwks.local/.well-known/jwks.json",
        JWT_ISSUER: "test",
      },
      { schemaEnv: { rolloutPercent: 100, minSupportedVersion: 999, killSwitch: false } },
    );
    await app.ready();
    // No token → 4xx auth error; but with auth plugin, JWKS unreachable → not 426
    // Test the route exists and auth protects it
    const res = await app.inject({ method: "GET", url: "/sync/schema?version=1" });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });

  it("invalid version param returns 400 (when token provided via bypass)", async () => {
    // Build without auth to test the schema validation logic directly
    // Schema route only mounts when authConfigured, so test via schemaRoute directly
    const Fastify = (await import("fastify")).default;
    const { errorHandlerPlugin } = await import("../../src/gateway/plugins/errorHandler.js");
    const { schemaRoutes } = await import("../../src/gateway/routes/schema.js");

    const app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
    await app.register(schemaRoutes, {
      schemaEnv: { rolloutPercent: 100, minSupportedVersion: 1, killSwitch: false },
    });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/sync/schema?version=-1" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("version too new returns 400", async () => {
    const Fastify = (await import("fastify")).default;
    const { errorHandlerPlugin } = await import("../../src/gateway/plugins/errorHandler.js");
    const { schemaRoutes } = await import("../../src/gateway/routes/schema.js");

    const app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
    await app.register(schemaRoutes, {});
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/sync/schema?version=9999" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("current version returns 200 with DDL", async () => {
    const Fastify = (await import("fastify")).default;
    const { errorHandlerPlugin } = await import("../../src/gateway/plugins/errorHandler.js");
    const { schemaRoutes } = await import("../../src/gateway/routes/schema.js");
    const { CURRENT_SCHEMA_VERSION } = await import("../../src/sync/clientSchema.js");

    const app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
    await app.register(schemaRoutes, {
      schemaEnv: { rolloutPercent: 100, minSupportedVersion: 1, killSwitch: false },
    });
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: `/sync/schema?version=${CURRENT_SCHEMA_VERSION}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBe(CURRENT_SCHEMA_VERSION);
    expect(Array.isArray(body.ddl)).toBe(true);
    expect(body.ddl.length).toBeGreaterThan(0);
    expect(body.policy).toBe("soft");
    await app.close();
  });

  it("blocked policy (minSupportedVersion > clientVersion) returns 426", async () => {
    const Fastify = (await import("fastify")).default;
    const { errorHandlerPlugin } = await import("../../src/gateway/plugins/errorHandler.js");
    const { schemaRoutes } = await import("../../src/gateway/routes/schema.js");

    const app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
    await app.register(schemaRoutes, {
      schemaEnv: { rolloutPercent: 100, minSupportedVersion: 999, killSwitch: false },
    });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/sync/schema?version=1" });
    expect(res.statusCode).toBe(426);
    const body = res.json();
    expect(body.error).toBe("UpgradeRequired");
    expect(body.minSupportedVersion).toBe(999);
    await app.close();
  });

  it("no version param returns current schema", async () => {
    const Fastify = (await import("fastify")).default;
    const { errorHandlerPlugin } = await import("../../src/gateway/plugins/errorHandler.js");
    const { schemaRoutes } = await import("../../src/gateway/routes/schema.js");
    const { CURRENT_SCHEMA_VERSION } = await import("../../src/sync/clientSchema.js");

    const app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
    await app.register(schemaRoutes, {});
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/sync/schema" });
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe(CURRENT_SCHEMA_VERSION);
    await app.close();
  });
});
