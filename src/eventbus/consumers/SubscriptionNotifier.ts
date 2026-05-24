import type {
  ConsumerContext,
  EventBusConsumer,
  NormalizedChangeEvent,
} from "../EventBus.js";
import type { SubscriptionRegistry } from "../../realtime/subscriptionRegistry.js";
import type { RedisFanout } from "../../realtime/redisFanout.js";
import type { OplogConsumerResult } from "./OplogConsumer.js";

export class SubscriptionNotifier implements EventBusConsumer {
  readonly name = "SubscriptionNotifier";
  readonly priority = 50;

  constructor(
    private readonly registry: SubscriptionRegistry,
    private readonly fanout: RedisFanout,
  ) {}

  async handle(event: NormalizedChangeEvent, ctx?: ConsumerContext): Promise<void> {
    // SPEC-026 — pick up real seq from OplogConsumer's result.
    const oplogResult = ctx?.oplogResult as OplogConsumerResult | undefined;
    const seq = oplogResult?.seq ?? 0;

    this.registry.notify(event.bucket, seq);

    // SPEC-034 — deliver persisted entry directly to local stream sessions.
    if (oplogResult?.entry) {
      const sessions = this.registry.deliverToSessions(event.bucket, seq);
      await Promise.allSettled(sessions.map((s) => s.deliver(oplogResult.entry)));
    }

    await this.fanout.publish(event.bucket, seq);
  }
}
