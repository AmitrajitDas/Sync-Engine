import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import type { OplogService } from "../../oplog/oplogService.js";
import type { SubscriptionRegistry } from "../../realtime/subscriptionRegistry.js";
import type { BucketChecksum } from "../../oplog/bucketChecksum.js";
import { StreamSession, type StreamStartFrame } from "../../realtime/streamSession.js";
import { resolveBucketsWithPriority } from "../../buckets/bucketResolver.js";
import type { SyncUser } from "../types.js";

export interface StreamRouteOptions {
  oplogService: OplogService;
  subscriptionRegistry: SubscriptionRegistry;
  bucketChecksum?: BucketChecksum;
  batchSize?: number;
}

function extractToken(url: string, authHeader?: string): string | null {
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  try {
    const u = new URL(url, "http://localhost");
    return u.searchParams.get("token");
  } catch {
    return null;
  }
}

export async function streamRoutes(
  app: FastifyInstance,
  opts: StreamRouteOptions,
): Promise<void> {
  await app.register(import("@fastify/websocket"));

  app.get("/sync/stream", { websocket: true }, async (socket: WebSocket, request) => {
    const rawToken = extractToken(request.url, request.headers.authorization);
    if (!rawToken) {
      socket.send(JSON.stringify({ type: "error", code: "bad_request", message: "missing token" }));
      socket.close(4401, "missing token");
      return;
    }

    let user: SyncUser;
    try {
      user = await app.verifyToken(rawToken);
    } catch {
      socket.send(JSON.stringify({ type: "error", code: "auth", message: "invalid token" }));
      socket.close(4401, "invalid token");
      return;
    }

    const withPrio = resolveBucketsWithPriority(user);
    const allowedBuckets = new Set(withPrio.map((b) => b.bucket));
    const bucketPriority = new Map<string, number>();
    for (const b of withPrio) bucketPriority.set(b.bucket, b.priority);

    let session: StreamSession | null = null;

    socket.on("message", (data: Buffer) => {
      let frame: { type?: string; [k: string]: unknown };
      try {
        frame = JSON.parse(data.toString());
      } catch {
        socket.send(JSON.stringify({ type: "error", code: "bad_request", message: "bad json" }));
        socket.close(4400, "bad json");
        return;
      }

      if (frame.type === "start") {
        if (session) return;
        const start = frame as unknown as StreamStartFrame;
        const buckets = (start.buckets ?? []).filter((b) => allowedBuckets.has(b));
        if (buckets.length === 0) {
          socket.send(
            JSON.stringify({ type: "error", code: "bad_request", message: "no accessible buckets" }),
          );
          socket.close(4400, "no buckets");
          return;
        }
        session = new StreamSession(
          {
            socket,
            oplog: opts.oplogService,
            bucketChecksum: opts.bucketChecksum,
            batchSize: opts.batchSize,
            bucketPriority,
          },
          { ...start, buckets },
        );
        opts.subscriptionRegistry.addSession(session);
        session
          .backfill()
          .catch((err) => {
            socket.send(
              JSON.stringify({ type: "error", code: "oplog_unavailable", message: String(err) }),
            );
            socket.close(1011, "oplog error");
          });
        return;
      }

      if (!session) return;
      if (frame.type === "ack") {
        session.ack(typeof frame.checkpoint === "number" ? frame.checkpoint : undefined);
      } else if (frame.type === "pause") {
        session.setPaused(true);
      } else if (frame.type === "resume") {
        session.setPaused(false);
        session.ack();
      }
    });

    socket.on("close", () => {
      if (session) {
        opts.subscriptionRegistry.removeSession(session);
        session.close();
      }
    });

    socket.on("error", () => {
      if (session) {
        opts.subscriptionRegistry.removeSession(session);
        session.close();
      }
    });
  });
}
