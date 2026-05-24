import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type { MongoClient } from "mongodb";
import type { DebeziumKafkaConsumer } from "../cdc/DebeziumKafkaConsumer.js";

export interface ShutdownDependencies {
  app: FastifyInstance;
  redis?: Redis;
  mongoClient?: MongoClient;
  kafkaConsumer?: DebeziumKafkaConsumer;
  grpcCloseTimeoutMs?: number;
  // SPEC-030 #9 — function returning live count of in-flight gRPC calls.
  grpcInflight?: () => number;
}

const POLL_INTERVAL_MS = 50;

async function waitForGrpcDrain(
  inflight: () => number,
  deadlineMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (inflight() === 0) return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

export function registerGracefulShutdown(deps: ShutdownDependencies): void {
  const { app } = deps;
  const grpcTimeout = deps.grpcCloseTimeoutMs ?? 10_000;

  async function shutdown(signal: string): Promise<void> {
    app.log.info({ signal }, "shutdown signal received");

    await app.close();
    app.log.info("fastify closed");

    if (deps.kafkaConsumer) {
      try {
        await deps.kafkaConsumer.stop();
        app.log.info("kafka consumer stopped");
      } catch (err) {
        app.log.error({ err }, "kafka consumer stop error");
      }
    }

    if (deps.grpcInflight) {
      await waitForGrpcDrain(deps.grpcInflight, grpcTimeout);
    } else {
      await new Promise((r) => setTimeout(r, grpcTimeout));
    }

    if (deps.redis) {
      try {
        await deps.redis.quit();
        app.log.info("redis closed");
      } catch (err) {
        app.log.error({ err }, "redis close error");
      }
    }

    if (deps.mongoClient) {
      try {
        await deps.mongoClient.close();
        app.log.info("mongodb closed");
      } catch (err) {
        app.log.error({ err }, "mongodb close error");
      }
    }

    app.log.info("shutdown complete");
    process.exit(0);
  }

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}
