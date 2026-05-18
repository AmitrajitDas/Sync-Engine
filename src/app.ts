import Fastify from "fastify";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import { healthRoutes } from "./gateway/routes/health.js";
import type { Env } from "./config/env.js";

export async function buildApp(env: Pick<Env, "LOG_LEVEL">) {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
  });

  await app.register(cors);
  await app.register(compress);
  await app.register(healthRoutes);

  return app;
}
