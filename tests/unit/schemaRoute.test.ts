import { describe, it, expect } from "vitest";
import { buildApp } from "../../src/app.js";

// SPEC-030 #2 — /sync/schema is private; only mounted when auth is registered.
describe("GET /sync/schema route mounting", () => {
  it("not mounted when auth plugin not configured", async () => {
    const app = await buildApp({ LOG_LEVEL: "silent" });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/sync/schema" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("mounted (auth-gated) when auth configured", async () => {
    const app = await buildApp({
      LOG_LEVEL: "silent",
      JWKS_URL: "http://jwks.local/.well-known/jwks.json",
      JWT_ISSUER: "test",
    });
    await app.ready();
    // Route exists but requires a token → not 404.
    const res = await app.inject({ method: "GET", url: "/sync/schema" });
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    await app.close();
  });
});
