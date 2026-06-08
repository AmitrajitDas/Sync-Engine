import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
/*
 * Tenant/bucket context plugin.
 *
 * After auth identifies the user, this plugin computes the sync buckets the
 * user can see. Routes should rely on request.buckets instead of re-deriving
 * access rules by hand.
 */
import fp from "fastify-plugin";
import { resolveBuckets } from "../../buckets/bucketResolver.js";
import { AuthError } from "./errorHandler.js";

function isRouteAuthenticatedWebSocket(request: FastifyRequest): boolean {
  if (request.headers.upgrade?.toLowerCase() !== "websocket") return false;
  const path = request.url.split("?")[0];
  return path === "/sync/subscribe" || path === "/sync/stream";
}

export const tenantContextPlugin = fp(async function tenantContextPlugin(app: FastifyInstance): Promise<void> {
  app.addHook(
    "preHandler",
    async (request: FastifyRequest, _reply: FastifyReply) => {
      if (!request.url.startsWith("/sync/")) return;
      if (isRouteAuthenticatedWebSocket(request)) return;
      if (!request.user) {
        // SPEC-030 #4 — surface 401 instead of 500 downstream.
        throw new AuthError("no user context on /sync route");
      }
      request.buckets = resolveBuckets(request.user);
    },
  );
});
