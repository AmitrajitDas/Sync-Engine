import type { FastifyInstance } from "fastify";
/*
 * POST /sync/pull
 *
 * Incremental download path. The client sends its last checkpoint, and the
 * server returns oplog entries after that seq for the client's accessible
 * buckets. This is the main offline-sync read flow.
 */
import type { OplogService } from "../../oplog/oplogService.js";
import { projectFields } from "../../sync/syncRulesEngine.js";
import { PullRequestSchema, PullResponseSchema } from "../schemas/pullSchema.js";
import { DependencyUnavailableError, ValidationError } from "../plugins/errorHandler.js";
import type { CheckpointCacheStore } from "../../oplog/checkpointCache.js";
import type { BucketChecksum } from "../../oplog/bucketChecksum.js";
import {
  bucketChecksumMismatchTotal,
  pullPriorityBucketTotal,
} from "../../observability/metrics.js";
import { resolveBucketsWithPriority } from "../../buckets/bucketResolver.js";

export interface PullRouteOptions {
  oplogService: OplogService;
  cache?: CheckpointCacheStore;
  bucketChecksum?: BucketChecksum;
  defaultLimit: number;
  maxLimit: number;
}

export async function pullRoutes(
  app: FastifyInstance,
  opts: PullRouteOptions,
): Promise<void> {
  app.post(
    "/sync/pull",
    {
      schema: {
        body: PullRequestSchema,
        response: { 200: PullResponseSchema },
      },
    },
    async (request) => {
      const userBuckets = request.buckets;
      if (!userBuckets || userBuckets.length === 0) {
        throw new Error("No bucket context");
      }

      const body = request.body as {
        checkpoint?: number;
        limit?: number;
        collections?: string[];
        priorityMax?: number;
        bucketStates?: Record<string, { seq: number; csum: number }>;
      };

      if (body.priorityMax !== undefined) {
        if (!Number.isInteger(body.priorityMax) || body.priorityMax < 0) {
          throw new ValidationError("priorityMax must be a non-negative integer");
        }
      }

      const clientCheckpoint = body.checkpoint ?? 0;
      const effectiveLimit = Math.min(body.limit ?? opts.defaultLimit, opts.maxLimit);
      const collectionsFilter = body.collections;

      // SPEC-033 — filter buckets by priorityMax.
      const user = request.user!;
      const withPrio = resolveBucketsWithPriority(user);
      let buckets = userBuckets;
      const bucketPriority = new Map<string, number>();
      for (const b of withPrio) bucketPriority.set(b.bucket, b.priority);

      if (body.priorityMax !== undefined) {
        const max = body.priorityMax;
        buckets = withPrio.filter((b) => b.priority <= max).map((b) => b.bucket);
        // wildcard admin bucket has no priority — include if any priority qualifies.
        for (const b of userBuckets) {
          if (b.endsWith(":*") && !buckets.includes(b)) buckets.push(b);
        }
        pullPriorityBucketTotal.inc({ priority: String(max) });
      }

      if (buckets.length === 0) {
        return {
          entries: [],
          checkpoint: clientCheckpoint,
          hasMore: false,
        };
      }

      // Fast path: if Redis says every bucket's latest checkpoint is already
      // <= the client's checkpoint, avoid querying Mongo entirely.
      if (opts.cache) {
        try {
          const values = await Promise.all(
            buckets.map((b) => opts.cache!.get(`sync:checkpoint:${b}`)),
          );
          const cached = values.filter((v): v is string => v != null).map(Number);
          if (cached.length === buckets.length && cached.every((c) => c <= clientCheckpoint)) {
            return {
              entries: [],
              checkpoint: clientCheckpoint,
              hasMore: false,
            };
          }
        } catch {
          // cache miss — continue to oplog
        }
      }

      let rawEntries;
      try {
        rawEntries = await opts.oplogService.getEntriesAfter(
          clientCheckpoint,
          buckets,
          {
            limit: effectiveLimit + 1,
            collections:
              collectionsFilter && collectionsFilter.length > 0 ? collectionsFilter : undefined,
          },
        );
      } catch (err) {
        throw new DependencyUnavailableError(`Oplog unavailable: ${(err as Error).message}`);
      }

      const hasMore = rawEntries.length > effectiveLimit;
      const entries = rawEntries.slice(0, effectiveLimit);

      const projected = entries.map(projectFields);

      // Priority lets clients pull critical bucket groups first while still
      // preserving seq order inside each priority level.
      projected.sort((a, b) => {
        const pa = a.priority ?? 100;
        const pb = b.priority ?? 100;
        if (pa !== pb) return pa - pb;
        return a.seq - b.seq;
      });

      // Advance checkpoint from the raw page, not the projected/sorted response,
      // so the client does not keep asking for entries it already skipped.
      const rawMaxSeq =
        entries.length > 0 ? entries[entries.length - 1].seq : clientCheckpoint;

      // SPEC-032 — bucket checksums.
      let bucketStatesResp:
        | Record<string, { seq: number; csum: number; mismatch?: boolean }>
        | undefined;
      if (opts.bucketChecksum) {
        try {
          const states = await Promise.all(
            buckets.map(async (b) => [b, await opts.bucketChecksum!.get(b)] as const),
          );
          bucketStatesResp = {};
          for (const [bucket, st] of states) {
            if (!st) continue;
            const clientState = body.bucketStates?.[bucket];
            let mismatch: boolean | undefined;
            if (clientState && clientState.seq === st.seq && clientState.csum !== st.csum) {
              mismatch = true;
              bucketChecksumMismatchTotal.inc({ bucket });
            }
            bucketStatesResp[bucket] = { seq: st.seq, csum: st.csum, mismatch };
          }
        } catch {
          bucketStatesResp = undefined;
        }
      }

      return {
        entries: projected.map((e) => ({
          seq: e.seq,
          collection: e.collection,
          docId: e.docId,
          operation: e.operation,
          delta: e.delta,
          fullDoc: e.fullDoc,
          bucket: e.bucket,
          tenantId: e.tenantId,
          timestamp: e.timestamp.toISOString(),
          origin: e.origin,
          clientId: e.clientId,
          clientSeq: e.clientSeq,
          priority: e.priority,
        })),
        checkpoint: rawMaxSeq,
        hasMore,
        bucketStates: bucketStatesResp,
      };
    },
  );
}
