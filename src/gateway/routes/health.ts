import type { FastifyInstance } from "fastify";

/*
 * Basic liveness route.
 *
 * This does not check dependencies; it only confirms the process can answer.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    return { status: "ok" };
  });
}
