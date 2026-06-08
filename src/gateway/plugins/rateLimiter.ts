import type { FastifyInstance } from "fastify";
/*
 * Per-route rate limits for expensive sync endpoints.
 *
 * Pull is high-volume and relatively cheap, push is lower-volume and mutating,
 * and snapshot is the most expensive bootstrap path.
 */
import fastifyRateLimit from "@fastify/rate-limit";
import type { Redis } from "ioredis";

export interface RateLimiterOptions {
  redis?: Redis;
}

export const ROUTE_LIMITS: Record<string, { max: number; timeWindow: string }> = {
  "/sync/pull":      { max: 200, timeWindow: "1 minute" },
  "/sync/push":      { max: 60,  timeWindow: "1 minute" },
  "/sync/snapshot":  { max: 5,   timeWindow: "1 minute" },
};

export async function rateLimiterPlugin(
  app: FastifyInstance,
  opts: RateLimiterOptions,
): Promise<void> {
  await app.register(fastifyRateLimit, {
    global: false,
    ...(opts.redis ? { redis: opts.redis } : {}),
    // Use authenticated user id when available; fall back to IP pre-auth.
    keyGenerator(request) {
      return request.user?.sub ?? request.ip ?? "unknown";
    },
    errorResponseBuilder(_req, context) {
      return {
        error: "TooManyRequests",
        message: `Rate limit exceeded. Try again in ${context.after}.`,
        statusCode: 429,
      };
    },
  });

  // Attach per-route limits via onRoute hook (correct for @fastify/rate-limit v10).
  // Hook runs before each route is registered, so limits are applied at registration time.
  for (const [url, limits] of Object.entries(ROUTE_LIMITS)) {
    app.addHook("onRoute", (routeOptions) => {
      if (routeOptions.url === url) {
        routeOptions.config = {
          ...(routeOptions.config ?? {}),
          rateLimit: {
            max: limits.max,
            timeWindow: limits.timeWindow,
          },
        };
      }
    });
  }
}
