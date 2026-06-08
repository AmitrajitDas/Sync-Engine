import type { OplogService } from "../../oplog/oplogService.js";
/*
 * First EventBus consumer in the CDC pipeline.
 *
 * Its job is to make the change durable in Mongo before any user-facing
 * notification is sent. The returned persisted entry is shared with later
 * consumers through EventBus context.
 */
import type { OplogEntry } from "../../oplog/oplogSchema.js";
import type { EventBusConsumer, NormalizedChangeEvent } from "../EventBus.js";
import type { CheckpointCacheStore } from "../../oplog/checkpointCache.js";
import { setMonotonic } from "../../oplog/checkpointCache.js";
import type { BucketChecksum } from "../../oplog/bucketChecksum.js";

export interface OplogConsumerResult {
  seq: number;
  entry: OplogEntry;
}

export class OplogConsumer implements EventBusConsumer {
  readonly name = "oplog";
  readonly priority = 10;

  constructor(
    private readonly oplog: OplogService,
    private readonly checkpointCache?: CheckpointCacheStore,
    private readonly bucketChecksum?: BucketChecksum,
  ) {}

  async handle(event: NormalizedChangeEvent): Promise<OplogConsumerResult> {
    const persisted = await this.oplog.appendToOplog(event);

    if (this.checkpointCache) {
      // Store per-bucket and tenant-wildcard checkpoints for fast "nothing new"
      // checks in pull/checkpoint routes.
      const tenantWildcard = tenantWildcardBucket(event.bucket);
      await Promise.all([
        setMonotonic(this.checkpointCache, `sync:checkpoint:${event.bucket}`, persisted.seq),
        tenantWildcard
          ? setMonotonic(this.checkpointCache, `sync:checkpoint:${tenantWildcard}`, persisted.seq)
          : Promise.resolve(),
      ]);
    }

    if (this.bucketChecksum) {
      await this.bucketChecksum.update(event.bucket, persisted);
    }

    return { seq: persisted.seq, entry: persisted };
  }
}

function tenantWildcardBucket(bucket: string): string | null {
  const m = bucket.match(/^tenant:([^:]+):/);
  return m ? `tenant:${m[1]}:*` : null;
}
