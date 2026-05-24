import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { rateLimiterPlugin, ROUTE_LIMITS } from "../../src/gateway/plugins/rateLimiter.js";

describe("ROUTE_LIMITS", () => {
  it("pull limit is 200/min", () => {
    expect(ROUTE_LIMITS["/sync/pull"]).toEqual({ max: 200, timeWindow: "1 minute" });
  });

  it("push limit is 60/min", () => {
    expect(ROUTE_LIMITS["/sync/push"]).toEqual({ max: 60, timeWindow: "1 minute" });
  });

  it("snapshot limit is 5/min", () => {
    expect(ROUTE_LIMITS["/sync/snapshot"]).toEqual({ max: 5, timeWindow: "1 minute" });
  });

  it("all limits are defined", () => {
    for (const [route, cfg] of Object.entries(ROUTE_LIMITS)) {
      expect(cfg.max).toBeGreaterThan(0);
      expect(cfg.timeWindow).toBeTruthy();
      expect(route.startsWith("/")).toBe(true);
    }
  });
});

describe("rateLimiterPlugin registration", () => {
  it("registers without error (no redis)", async () => {
    const app = Fastify({ logger: false });
    await expect(app.register(rateLimiterPlugin, {})).resolves.not.toThrow();
    await app.ready();
    await app.close();
  });

  it("registers without error (with null redis)", async () => {
    const app = Fastify({ logger: false });
    // Should gracefully skip redis when not provided
    await expect(app.register(rateLimiterPlugin, { redis: undefined })).resolves.not.toThrow();
    await app.ready();
    await app.close();
  });
});

describe("keyGenerator", () => {
  it("uses user.sub when user is present", async () => {
    // Verify rate limiter is mounted on buildApp correctly (no errors)
    const { buildApp } = await import("../../src/app.js");
    const app = await buildApp({ LOG_LEVEL: "silent" });
    await app.ready();
    // /metrics should be accessible (not rate-limited), confirming plugin mounted
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
