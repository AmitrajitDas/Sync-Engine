import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import type { OplogService } from "../../oplog/oplogService.js";
import type { SubscriptionRegistry } from "../../realtime/subscriptionRegistry.js";
import { resolveBuckets } from "../../buckets/bucketResolver.js";
import type { SyncUser } from "../types.js";

const PING_INTERVAL_MS = 30_000;
const IDLE_TIMEOUT_MS = 120_000;

export interface SubscribeRouteOptions {
  oplogService: OplogService;
  subscriptionRegistry: SubscriptionRegistry;
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

export async function subscribeRoutes(
  app: FastifyInstance,
  opts: SubscribeRouteOptions,
): Promise<void> {
  await app.register(import("@fastify/websocket"));

  app.get("/sync/subscribe", { websocket: true }, async (socket: WebSocket, request) => {
    const rawToken = extractToken(request.url, request.headers.authorization);
    if (!rawToken) {
      socket.close(4401, "Missing token");
      return;
    }

    let user: SyncUser;
    try {
      user = await app.verifyToken(rawToken);
    } catch {
      socket.close(4401, "Invalid token");
      return;
    }

    const buckets = resolveBuckets(user);
    opts.subscriptionRegistry.add(socket, buckets);

    const query = request.query as { seq?: string };
    const clientSeq = query.seq ? Number(query.seq) : 0;
    try {
      const latestSeq = await opts.oplogService.getLatestSeq(buckets);
      if (latestSeq > clientSeq) {
        socket.send(JSON.stringify({ type: "checkpoint", buckets, seq: latestSeq }));
      }
    } catch {
      // Non-fatal — client will poll
    }

    const pingTimer = setInterval(() => {
      if (socket.readyState === socket.OPEN) socket.ping();
    }, PING_INTERVAL_MS);

    let idleTimer = setTimeout(() => socket.close(1000, "idle"), IDLE_TIMEOUT_MS);
    socket.on("pong", () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => socket.close(1000, "idle"), IDLE_TIMEOUT_MS);
    });

    socket.on("close", () => {
      clearInterval(pingTimer);
      clearTimeout(idleTimer);
      opts.subscriptionRegistry.remove(socket);
    });

    socket.on("error", () => {
      opts.subscriptionRegistry.remove(socket);
    });
  });
}
