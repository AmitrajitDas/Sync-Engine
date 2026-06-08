import type { ConflictContext, ConflictResult, ConflictStrategy } from "../conflictTypes.js";

/*
 * Server-wins strategy.
 *
 * Used for collections where client-side merging is risky. If the server has
 * any version of the document, the client must reconcile against that version.
 */
export class ServerWinsStrategy implements ConflictStrategy {
  resolve(ctx: ConflictContext): ConflictResult {
    const { serverLatest } = ctx;

    if (!serverLatest) {
      return { outcome: "client_wins", payload: ctx.write.payload };
    }

    if (serverLatest.operation === "REMOVE") {
      return { outcome: "server_wins", payload: {}, serverVersion: {} };
    }

    const serverDoc = (serverLatest.fullDoc ?? serverLatest.delta ?? {}) as Record<string, unknown>;

    return {
      outcome: "server_wins",
      payload: serverDoc,
      serverVersion: serverDoc,
    };
  }
}
