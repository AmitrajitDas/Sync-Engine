import Fastify, { type FastifyRequest } from "fastify";
/*
 * Fastify application factory.
 *
 * `index.ts` passes real dependencies here in production. Tests can call
 * `buildApp()` with only the dependencies needed for the route under test, so
 * routes are mounted conditionally instead of every test needing Mongo, Redis,
 * Kafka, and gRPC.
 */
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import type { Env } from "./config/env.js";
import type { Db, MongoClient } from "mongodb";
import type { Redis } from "ioredis";
import type { OplogService } from "./oplog/oplogService.js";
import type { RbacCheckClient } from "./grpc/RbacCheckClient.js";
import type { BusinessProxyClient } from "./grpc/BusinessProxyClient.js";
import type { AttachmentClient } from "./grpc/AttachmentClient.js";
import type { ConflictResolver } from "./conflicts/conflictResolver.js";
import type { SnapshotReader } from "./gateway/routes/snapshot.js";
import type { SubscriptionRegistry } from "./realtime/subscriptionRegistry.js";
import type { BucketChecksum } from "./oplog/bucketChecksum.js";
import type { CheckpointCacheStore } from "./oplog/checkpointCache.js";

import { healthRoutes } from "./gateway/routes/health.js";
import { healthzRoutes } from "./gateway/routes/healthz.js";
import { errorHandlerPlugin } from "./gateway/plugins/errorHandler.js";
import { authPlugin } from "./gateway/plugins/auth.js";
import { tenantContextPlugin } from "./gateway/plugins/tenantContext.js";
import { rateLimiterPlugin } from "./gateway/plugins/rateLimiter.js";
import { checkpointRoutes } from "./gateway/routes/checkpoint.js";
import { pullRoutes } from "./gateway/routes/pull.js";
import { pushRoutes } from "./gateway/routes/push.js";
import { snapshotRoutes } from "./gateway/routes/snapshot.js";
import { schemaRoutes } from "./gateway/routes/schema.js";
import { attachmentRoutes } from "./gateway/routes/attachment.js";
import { subscribeRoutes } from "./gateway/routes/subscribe.js";
import { streamRoutes } from "./gateway/routes/stream.js";
import { ensureWebsocketPlugin } from "./gateway/plugins/websocket.js";
import { metricsRoute } from "./observability/metricsRoute.js";

const SENSITIVE_QUERY_PARAMS = ["token", "access_token", "id_token", "jwt"];

function redactSensitiveQueryParams(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return rawUrl;

  try {
    const url = new URL(rawUrl, "http://localhost");
    let redacted = false;
    for (const param of SENSITIVE_QUERY_PARAMS) {
      if (url.searchParams.has(param)) {
        url.searchParams.set(param, "[REDACTED]");
        redacted = true;
      }
    }

    return redacted ? `${url.pathname}${url.search}` : rawUrl;
  } catch {
    return rawUrl;
  }
}

function serializeRequestForLogs(req: FastifyRequest) {
  const raw = req.raw;
  return {
    method: raw.method,
    url: redactSensitiveQueryParams(raw.url),
    host: raw.headers.host,
    remoteAddress: raw.socket.remoteAddress,
    remotePort: raw.socket.remotePort,
  };
}

export interface SchemaEnv {
  rolloutPercent: number;
  minSupportedVersion: number;
  killSwitch: boolean;
}

export interface AppDependencies {
  mongo?: Db;
  mongoClient?: MongoClient;
  redis?: Redis;
  oplogService?: OplogService;
  rbacCheck?: RbacCheckClient;
  businessProxy?: BusinessProxyClient;
  attachmentClient?: AttachmentClient;
  conflictResolver?: ConflictResolver;
  snapshotReader?: SnapshotReader;
  subscriptionRegistry?: SubscriptionRegistry;
  bucketChecksum?: BucketChecksum;
  schemaEnv?: SchemaEnv;
}

export async function buildApp(
  env: Pick<Env, "LOG_LEVEL"> &
    Partial<Pick<Env, "JWKS_URL" | "JWT_ISSUER" | "JWT_AUDIENCE" | "PULL_DEFAULT_LIMIT" | "PULL_MAX_LIMIT">>,
  deps: AppDependencies = {},
) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: ["req.headers.authorization", "*.token", "*.jwt", "*.password"],
        censor: "[REDACTED]",
      },
      serializers: {
        req: serializeRequestForLogs,
      },
    },
  });

  await app.register(cors);
  await app.register(compress);

  await app.register(errorHandlerPlugin);

  await app.register(healthRoutes);
  await app.register(healthzRoutes, { mongo: deps.mongo, redis: deps.redis });
  await app.register(metricsRoute);

  await app.register(rateLimiterPlugin, { redis: deps.redis });

  // Auth + tenant context for /sync/* routes.
  const authConfigured = Boolean(env.JWKS_URL && env.JWT_ISSUER);
  if (authConfigured) {
    await app.register(authPlugin, {
      jwksUrl: env.JWKS_URL!,
      issuer: env.JWT_ISSUER!,
      audience: env.JWT_AUDIENCE,
    });
    await app.register(tenantContextPlugin);
  }

  const cacheStore: CheckpointCacheStore | undefined = deps.redis
    ? (deps.redis as unknown as CheckpointCacheStore)
    : undefined;

  // Pull/checkpoint are read-only oplog routes, so they only need the oplog
  // service plus optional Redis-backed fast paths.
  if (deps.oplogService) {
    await app.register(checkpointRoutes, {
      oplogService: deps.oplogService,
      cache: cacheStore,
      bucketChecksum: deps.bucketChecksum,
    });

    await app.register(pullRoutes, {
      oplogService: deps.oplogService,
      defaultLimit: env.PULL_DEFAULT_LIMIT ?? 500,
      maxLimit: env.PULL_MAX_LIMIT ?? 1000,
      cache: cacheStore,
      bucketChecksum: deps.bucketChecksum,
    });
  }

  if (
    deps.oplogService &&
    deps.conflictResolver &&
    deps.rbacCheck &&
    deps.businessProxy
  ) {
    // Push needs the full write pipeline: local validation, conflict lookup,
    // RBAC authorization, and business persistence through gRPC.
    await app.register(pushRoutes, {
      oplogService: deps.oplogService,
      conflictResolver: deps.conflictResolver,
      rbacCheck: deps.rbacCheck,
      businessProxy: deps.businessProxy,
    });
  }

  if (deps.oplogService && deps.snapshotReader && deps.rbacCheck) {
    // Snapshot is a bootstrap path: stream full rows from Postgres and mark the
    // oplog seq that the client should continue pulling from afterward.
    await app.register(snapshotRoutes, {
      oplogService: deps.oplogService,
      snapshotReader: deps.snapshotReader,
      rbacCheck: deps.rbacCheck,
    });
  }

  // SPEC-030 #2 — /sync/schema is private; only mount when auth is registered.
  if (authConfigured) {
    await app.register(schemaRoutes, { schemaEnv: deps.schemaEnv });
  }

  if (deps.attachmentClient) {
    // Attachments are not stored here; this route only brokers signed URLs.
    await app.register(attachmentRoutes, { attachmentClient: deps.attachmentClient });
  }

  if (authConfigured && deps.oplogService && deps.subscriptionRegistry) {
    // WebSocket routes require auth because bucket membership is derived from
    // the JWT, then reused to filter live checkpoint/data notifications.
    await ensureWebsocketPlugin(app);
    await app.register(subscribeRoutes, {
      oplogService: deps.oplogService,
      subscriptionRegistry: deps.subscriptionRegistry,
    });
    await app.register(streamRoutes, {
      oplogService: deps.oplogService,
      subscriptionRegistry: deps.subscriptionRegistry,
      bucketChecksum: deps.bucketChecksum,
    });
  }

  return app;
}
