import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { resolveBuckets } from "../../buckets/bucketResolver.js";
import { AuthError } from "./errorHandler.js";

export const tenantContextPlugin = fp(async function tenantContextPlugin(app: FastifyInstance): Promise<void> {
  app.addHook(
    "preHandler",
    async (request: FastifyRequest, _reply: FastifyReply) => {
      if (!request.url.startsWith("/sync/")) return;
      if (!request.user) {
        // SPEC-030 #4 — surface 401 instead of 500 downstream.
        throw new AuthError("no user context on /sync route");
      }
      request.buckets = resolveBuckets(request.user);
    },
  );
});
