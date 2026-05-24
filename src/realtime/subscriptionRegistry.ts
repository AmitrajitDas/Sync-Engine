import type { WebSocket } from "@fastify/websocket";
import type { StreamSession } from "./streamSession.js";

interface Connection {
  socket: WebSocket;
  buckets: Set<string>;
}

export class SubscriptionRegistry {
  private readonly connections = new Map<WebSocket, Connection>();
  private readonly bucketIndex = new Map<string, Set<WebSocket>>();
  // SPEC-034 — track streaming sessions per bucket.
  private readonly sessions = new Set<StreamSession>();
  private readonly sessionBuckets = new Map<string, Set<StreamSession>>();

  add(socket: WebSocket, buckets: string[]): void {
    const conn: Connection = { socket, buckets: new Set(buckets) };
    this.connections.set(socket, conn);
    for (const bucket of buckets) {
      if (!this.bucketIndex.has(bucket)) this.bucketIndex.set(bucket, new Set());
      this.bucketIndex.get(bucket)!.add(socket);
    }
  }

  remove(socket: WebSocket): void {
    const conn = this.connections.get(socket);
    if (!conn) return;
    for (const bucket of conn.buckets) {
      const sockets = this.bucketIndex.get(bucket);
      if (sockets) {
        sockets.delete(socket);
        if (sockets.size === 0) this.bucketIndex.delete(bucket);
      }
    }
    this.connections.delete(socket);
  }

  addSession(session: StreamSession): void {
    this.sessions.add(session);
    for (const bucket of session.buckets) {
      if (!this.sessionBuckets.has(bucket)) this.sessionBuckets.set(bucket, new Set());
      this.sessionBuckets.get(bucket)!.add(session);
    }
  }

  removeSession(session: StreamSession): void {
    this.sessions.delete(session);
    for (const bucket of session.buckets) {
      const s = this.sessionBuckets.get(bucket);
      if (s) {
        s.delete(session);
        if (s.size === 0) this.sessionBuckets.delete(bucket);
      }
    }
  }

  notify(bucket: string, seq: number): void {
    const sockets = this.bucketIndex.get(bucket);
    if (sockets) {
      const message = JSON.stringify({ type: "checkpoint", bucket, seq });
      for (const socket of sockets) {
        try {
          if (socket.readyState === socket.OPEN) {
            socket.send(message);
          }
        } catch {
          // already closed
        }
      }
    }
  }

  deliverToSessions(bucket: string, seq: number): StreamSession[] {
    const s = this.sessionBuckets.get(bucket);
    return s ? [...s] : [];
  }

  size(): number {
    return this.connections.size;
  }

  sessionCount(): number {
    return this.sessions.size;
  }
}
