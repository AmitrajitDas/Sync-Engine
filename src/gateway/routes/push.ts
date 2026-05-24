import type { FastifyInstance } from "fastify";
import type { OplogService } from "../../oplog/oplogService.js";
import type { RbacCheckClient } from "../../grpc/RbacCheckClient.js";
import type { BusinessProxyClient } from "../../grpc/BusinessProxyClient.js";
import type { ConflictResolver } from "../../conflicts/conflictResolver.js";
import { validateWrite } from "../../sync/syncRulesEngine.js";
import { ValidationError, DependencyUnavailableError } from "../plugins/errorHandler.js";
import { PushRequestSchema, PushResponseSchema } from "../schemas/pushSchema.js";
import type { WriteRequest } from "../../sync/syncTypes.js";

export interface PushRouteOptions {
  oplogService: OplogService;
  conflictResolver: ConflictResolver;
  rbacCheck: RbacCheckClient;
  businessProxy: BusinessProxyClient;
}

interface PushResultItem {
  docId: string;
  status: "applied" | "rejected" | "conflict";
  serverSeq?: number;
  writeCheckpoint?: number;
  serverVersion?: Record<string, unknown>;
  reason?: string;
}

export async function pushRoutes(
  app: FastifyInstance,
  opts: PushRouteOptions,
): Promise<void> {
  app.post(
    "/sync/push",
    {
      schema: {
        body: PushRequestSchema,
        response: { 200: PushResponseSchema },
      },
    },
    async (request) => {
      const user = request.user;
      if (!user) {
        throw new Error("No user context");
      }

      const body = request.body as {
        clientId: string;
        writes: WriteRequest[];
      };

      const results: PushResultItem[] = [];
      let maxCheckpoint = 0;

      for (const write of body.writes) {
        let cleaned: WriteRequest;
        try {
          cleaned = validateWrite(write, user);
        } catch (err) {
          if (err instanceof ValidationError) {
            results.push({ docId: write.docId, status: "rejected", reason: err.message });
            continue;
          }
          throw err;
        }

        let conflictResult;
        try {
          conflictResult = await opts.conflictResolver.resolve(cleaned);
        } catch (err) {
          throw new DependencyUnavailableError(
            `Conflict resolution failed: ${(err as Error).message}`,
          );
        }

        if (conflictResult.outcome === "server_wins" && conflictResult.serverVersion) {
          results.push({
            docId: write.docId,
            status: "conflict",
            serverVersion: conflictResult.serverVersion,
          });
          continue;
        }

        const writeToSend = { ...cleaned, payload: conflictResult.payload };

        let allowed = true;
        try {
          allowed = await opts.rbacCheck.check(user, writeToSend);
        } catch (err) {
          if (err instanceof DependencyUnavailableError) throw err;
          results.push({ docId: write.docId, status: "rejected", reason: "RBAC check failed" });
          continue;
        }

        if (!allowed) {
          results.push({ docId: write.docId, status: "rejected", reason: "Permission denied" });
          continue;
        }

        let applyResult;
        try {
          applyResult = await opts.businessProxy.applyWrite(writeToSend, user, body.clientId);
        } catch (err) {
          if (err instanceof DependencyUnavailableError) throw err;
          results.push({ docId: write.docId, status: "rejected", reason: (err as Error).message });
          continue;
        }

        if (applyResult.status === "rejected") {
          results.push({ docId: write.docId, status: "rejected", reason: applyResult.reason });
          continue;
        }

        const checkpoint = applyResult.writeCheckpoint ?? applyResult.serverSeq;
        if (checkpoint && checkpoint > maxCheckpoint) maxCheckpoint = checkpoint;

        results.push({
          docId: write.docId,
          status: "applied",
          serverSeq: applyResult.serverSeq,
          writeCheckpoint: applyResult.writeCheckpoint,
        });
      }

      return { results, checkpoint: maxCheckpoint };
    },
  );
}
