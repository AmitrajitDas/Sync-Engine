import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/app.js";
import {
  AuthError,
  ValidationError,
  ConflictError,
  PermissionError,
  DependencyUnavailableError,
} from "../../src/gateway/plugins/errorHandler.js";

const app = await buildApp({ LOG_LEVEL: "silent" });

// Inject test routes that throw each error type
app.get("/test/auth-error", async () => { throw new AuthError("bad token"); });
app.get("/test/validation-error", async () => { throw new ValidationError("bad input"); });
app.get("/test/conflict-error", async () => { throw new ConflictError("conflict"); });
app.get("/test/permission-error", async () => { throw new PermissionError("no access"); });
app.get("/test/dep-error", async () => { throw new DependencyUnavailableError("down"); });
app.get("/test/unknown-error", async () => { throw new Error("unexpected"); });

beforeAll(async () => app.ready());
afterAll(async () => app.close());

describe("errorHandlerPlugin", () => {
  it("returns 401 for AuthError", async () => {
    const res = await app.inject({ method: "GET", url: "/test/auth-error" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("AuthError");
  });

  it("returns 400 for ValidationError", async () => {
    const res = await app.inject({ method: "GET", url: "/test/validation-error" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 409 for ConflictError", async () => {
    const res = await app.inject({ method: "GET", url: "/test/conflict-error" });
    expect(res.statusCode).toBe(409);
  });

  it("returns 403 for PermissionError", async () => {
    const res = await app.inject({ method: "GET", url: "/test/permission-error" });
    expect(res.statusCode).toBe(403);
  });

  it("returns 503 for DependencyUnavailableError", async () => {
    const res = await app.inject({ method: "GET", url: "/test/dep-error" });
    expect(res.statusCode).toBe(503);
  });

  it("returns 500 for unhandled errors", async () => {
    const res = await app.inject({ method: "GET", url: "/test/unknown-error" });
    expect(res.statusCode).toBe(500);
  });
});
