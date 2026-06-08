import websocket from "@fastify/websocket";
import type {
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerBase,
} from "fastify";

const registeredServers = new WeakSet<object>();

/*
 * WebSocket routes can be mounted independently in tests, but production mounts
 * both subscribe and stream routes on the same Fastify instance. Register the
 * plugin once so Fastify does not install duplicate HTTP upgrade handlers.
 */
export async function ensureWebsocketPlugin<Server extends RawServerBase>(
  app: FastifyInstance<
    Server,
    RawRequestDefaultExpression<Server>,
    RawReplyDefaultExpression<Server>
  >,
): Promise<void> {
  if (registeredServers.has(app.server)) return;

  await app.register(websocket);
  registeredServers.add(app.server);
}
