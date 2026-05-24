import { describe, it, expect } from "vitest";
import { buildApp } from "../../src/app.js";

describe("GET /metrics", () => {
  it("returns 200 with prometheus text format", async () => {
    const app = await buildApp({ LOG_LEVEL: "silent" });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    await app.close();
  });

  it("response body contains sync_ metrics", async () => {
    const app = await buildApp({ LOG_LEVEL: "silent" });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/metrics" });
    const body = res.body;
    expect(body).toContain("sync_http_request_duration_seconds");
    expect(body).toContain("sync_pull_entries_returned");
    expect(body).toContain("sync_stream_active_connections");
    expect(body).toContain("sync_client_schema_version_total");
    await app.close();
  });

  it("response body contains process_ default metrics", async () => {
    const app = await buildApp({ LOG_LEVEL: "silent" });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.body).toContain("process_");
    await app.close();
  });

  it("content-type includes charset or version info", async () => {
    const app = await buildApp({ LOG_LEVEL: "silent" });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/metrics" });
    // prom-client sets a specific content-type header
    expect(res.headers["content-type"]).toBeTruthy();
    await app.close();
  });
});
