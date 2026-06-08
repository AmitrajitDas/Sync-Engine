import type { FastifyInstance } from "fastify";
/*
 * GET /sync/checkpoint
 *
 * Lightweight "is there anything new?" endpoint. Clients can call this before
 * a pull to know the latest visible seq for their buckets.
 */
import type { OplogService } from "../../oplog/oplogService.js";
import { CheckpointResponseSchema } from "../schemas/checkpointSchema.js";
import { DependencyUnavailableError } from "../plugins/errorHandler.js";
import type { BucketChecksum } from "../../oplog/bucketChecksum.js";

export interface CheckpointCache {
  get(key: string): Promise<string | null>;
}

export interface CheckpointRouteOptions {
  oplogService: OplogService;
  cache?: CheckpointCache;
  bucketChecksum?: BucketChecksum;
}

export async function checkpointRoutes(
  app: FastifyInstance,
  opts: CheckpointRouteOptions,
): Promise<void> {
  app.get(
    "/sync/checkpoint",
    { schema: { response: { 200: CheckpointResponseSchema } } },
    async (request) => {
      const buckets = request.buckets;
      if (!buckets || buckets.length === 0) {
        throw new Error("No bucket context on request");
      }

      let checkpoint = 0;
      let resolved = false;

      if (opts.cache) {
        // Redis checkpoint cache avoids a Mongo query when CDC consumers have
        // already recorded the latest seq per bucket.
        try {
          const values = await Promise.all(
            buckets.map((b) => opts.cache!.get(`sync:checkpoint:${b}`)),
          );
          const cached = values.filter((v): v is string => v != null).map(Number);
          if (cached.length > 0) {
            checkpoint = Math.max(...cached);
            resolved = true;
          }
        } catch {
          // cache failure — fall through to oplog
        }
      }

      if (!resolved) {
        try {
          checkpoint = await opts.oplogService.getLatestSeq(buckets);
        } catch (err) {
          throw new DependencyUnavailableError(`Oplog unavailable: ${(err as Error).message}`);
        }
      }

      let bucketStates: Record<string, { seq: number; csum: number }> | undefined;
      if (opts.bucketChecksum) {
        try {
          const entries = await Promise.all(
            buckets.map(async (b) => [b, await opts.bucketChecksum!.get(b)] as const),
          );
          bucketStates = {};
          for (const [bucket, st] of entries) {
            if (st) bucketStates[bucket] = { seq: st.seq, csum: st.csum };
          }
        } catch {
          bucketStates = undefined;
        }
      }

      return { checkpoint, buckets, bucketStates };
    },
  );
}
