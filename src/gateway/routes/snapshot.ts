import type { FastifyInstance } from "fastify";
/*
 * GET /sync/snapshot
 *
 * Bootstrap path for a client that needs a full dataset for a bucket. The final
 * NDJSON line includes snapshotSeq so the client can continue with incremental
 * pull from the correct oplog checkpoint.
 */
import type { OplogService } from "../../oplog/oplogService.js";
import type { RbacCheckClient } from "../../grpc/RbacCheckClient.js";
import { pullRules } from "../../sync/syncRules.js";
import { COLLECTIONS, effectivePriority } from "../../sync/syncRegistry.js";
import { bucketMatchesUser } from "../../buckets/bucketResolver.js";
import {
  PermissionError,
  ValidationError,
  DependencyUnavailableError,
  AuthError,
} from "../plugins/errorHandler.js";
import { SnapshotQuerySchema } from "../schemas/snapshotSchema.js";
import type { WriteRequest } from "../../sync/syncTypes.js";

export interface SnapshotReadParams {
  collection: string;
  bucket: string;
  tenantId: string;
}

export interface SnapshotReader {
  streamCollection(params: SnapshotReadParams): AsyncIterable<Record<string, unknown>>;
}

export interface SnapshotRouteOptions {
  oplogService: OplogService;
  snapshotReader: SnapshotReader;
  rbacCheck: RbacCheckClient;
}

export async function snapshotRoutes(
  app: FastifyInstance,
  opts: SnapshotRouteOptions,
): Promise<void> {
  app.get(
    "/sync/snapshot",
    { schema: { querystring: SnapshotQuerySchema } },
    async (request, reply) => {
      const user = request.user;
      if (!user) throw new AuthError("no user context on /sync/snapshot");
      const userBuckets = request.buckets;

      const query = request.query as {
        bucket: string;
        collections?: string;
        priorityMax?: number;
      };
      const requestedBucket = query.bucket;
      const collectionsParam = query.collections;
      const priorityMax = query.priorityMax;

      if (!bucketMatchesUser(requestedBucket, userBuckets)) {
        throw new PermissionError(`Bucket "${requestedBucket}" not accessible by this user`);
      }

      const allCollections = Object.keys(pullRules);
      let requestedCollections = collectionsParam
        ? collectionsParam.split(",").map((c) => c.trim())
        : allCollections;

      for (const col of requestedCollections) {
        if (!pullRules[col]) {
          throw new ValidationError(`Unknown collection: ${col}`);
        }
      }

      // SPEC-033 — filter by priority.
      if (priorityMax !== undefined) {
        requestedCollections = requestedCollections.filter(
          (c) => effectivePriority(COLLECTIONS[c]) <= priorityMax,
        );
      }

      for (const col of requestedCollections) {
        const pseudoWrite: WriteRequest = {
          collection: col,
          docId: "*",
          operation: "PUT",
          payload: {},
          clientTimestamp: new Date().toISOString(),
          baseSeq: 0,
          clientSeq: 0,
          idempotencyKey: "snapshot-check",
        };
        let allowed = false;
        try {
          allowed = await opts.rbacCheck.check(user, pseudoWrite);
        } catch (err) {
          if (err instanceof DependencyUnavailableError) throw err;
          throw new DependencyUnavailableError(`RBAC unavailable: ${(err as Error).message}`);
        }
        if (!allowed) {
          throw new PermissionError(`Access to collection "${col}" denied`);
        }
      }

      let snapshotSeq: number;
      try {
        // Capture the oplog high-water mark before streaming rows. The client
        // uses this seq as the bridge from snapshot to incremental sync.
        snapshotSeq = await opts.oplogService.getLatestSeq([requestedBucket]);
      } catch (err) {
        throw new DependencyUnavailableError(`Oplog unavailable: ${(err as Error).message}`);
      }

      // Hijack before the first write so Fastify does not try to serialize a
      // normal JSON response after we have started chunked NDJSON streaming.
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked",
      });

      const stream = reply.raw;
      try {
        for (const col of requestedCollections) {
          const rule = pullRules[col];
          const rows = opts.snapshotReader.streamCollection({
            collection: col,
            bucket: requestedBucket,
            tenantId: user.tenantId,
          });

          for await (const row of rows) {
            let projected = row;
            if (rule.allowedFields) {
              projected = Object.fromEntries(
                Object.entries(row).filter(([k]) => rule.allowedFields!.includes(k)),
              );
            }
            stream.write(JSON.stringify({ collection: col, doc: projected }) + "\n");
          }
        }

        stream.write(
          JSON.stringify({
            _meta: { snapshotSeq, collections: requestedCollections },
          }) + "\n",
        );
      } catch (err) {
        app.log.error({ err, bucket: requestedBucket }, "snapshot stream error");
      } finally {
        stream.end();
      }
    },
  );
}
