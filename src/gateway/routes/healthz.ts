import type { FastifyInstance } from "fastify";
/*
 * Kubernetes-style health routes.
 *
 * /health/live checks that the process is alive. /health/ready checks whether
 * dependencies are available enough for the service to receive traffic.
 */
import type { Db } from "mongodb";
import type { Redis } from "ioredis";

export interface ReadinessCheck {
  name: string;
  check(): Promise<boolean>;
}

export interface HealthzRouteOptions {
  mongo?: Db;
  redis?: Redis;
  checks?: ReadinessCheck[];
}

export async function healthzRoutes(
  app: FastifyInstance,
  opts: HealthzRouteOptions,
): Promise<void> {
  app.get("/health/live", async () => {
    return { status: "ok" };
  });

  app.get("/health/ready", async (_request, reply) => {
    const checks: Record<string, "ok" | "fail"> = {};
    let allOk = true;

    if (opts.mongo) {
      try {
        await opts.mongo.command({ ping: 1 });
        checks.mongo = "ok";
      } catch {
        checks.mongo = "fail";
        allOk = false;
      }
    }

    if (opts.redis) {
      try {
        await opts.redis.ping();
        checks.redis = "ok";
      } catch {
        checks.redis = "fail";
        allOk = false;
      }
    }

    for (const extra of opts.checks ?? []) {
      try {
        const ok = await extra.check();
        checks[extra.name] = ok ? "ok" : "fail";
        if (!ok) allOk = false;
      } catch {
        checks[extra.name] = "fail";
        allOk = false;
      }
    }

    const status = allOk ? 200 : 503;
    return reply.status(status).send({ status: allOk ? "ready" : "degraded", checks });
  });
}
