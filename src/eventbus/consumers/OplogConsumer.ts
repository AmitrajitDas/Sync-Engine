import type { OplogService } from "../../oplog/oplogService.js";
import type { EventBusConsumer, NormalizedChangeEvent } from "../EventBus.js";

export interface CheckpointCache {
  set(key: string, value: string): Promise<unknown>;
}

export class OplogConsumer implements EventBusConsumer {
  readonly name = "oplog";

  constructor(
    private readonly oplog: OplogService,
    private readonly checkpointCache?: CheckpointCache,
  ) {}

  async handle(event: NormalizedChangeEvent): Promise<void> {
    const persisted = await this.oplog.appendToOplog(event);
    if (this.checkpointCache) {
      await this.checkpointCache.set(
        `sync:checkpoint:${event.bucket}`,
        String(persisted.seq),
      );
    }
  }
}
