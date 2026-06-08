import type { FastifyInstance } from "fastify";
/*
 * Prometheus scrape endpoint.
 *
 * Exposes all metrics registered in observability/metrics.ts at /metrics.
 */
import { registry } from "./metrics.js";

export async function metricsRoute(app: FastifyInstance): Promise<void> {
  app.get("/metrics", async (_request, reply) => {
    const output = await registry.metrics();
    reply.header("Content-Type", registry.contentType);
    return reply.send(output);
  });
}
