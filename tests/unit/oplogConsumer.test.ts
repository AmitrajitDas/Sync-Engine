import { describe, it, expect, vi } from "vitest";
import { InProcessEventBus } from "../../src/eventbus/InProcessEventBus.js";
import { OplogConsumer } from "../../src/eventbus/consumers/OplogConsumer.js";
import { SubscriptionNotifier } from "../../src/eventbus/consumers/SubscriptionNotifier.js";
import type { OplogService } from "../../src/oplog/oplogService.js";
import type { NormalizedChangeEvent } from "../../src/eventbus/EventBus.js";
import { ObjectId } from "mongodb";

function makeEvent(): NormalizedChangeEvent {
  return {
    collection: "farms",
    docId: "f1",
    operation: "PUT",
    delta: null,
    bucket: "tenant:t1:region:north",
    tenantId: "t1",
    timestamp: new Date(),
    origin: "server",
  };
}

describe("OplogConsumer + SubscriptionNotifier ordering", () => {
  it("notifier receives the real seq, not 0", async () => {
    const persisted = {
      _id: new ObjectId(),
      seq: 99,
      timestamp: new Date(),
      collection: "farms",
      docId: "f1",
      operation: "PUT" as const,
      delta: null,
      bucket: "tenant:t1:region:north",
      tenantId: "t1",
      origin: "server" as const,
    };
    const oplog = {
      appendToOplog: vi.fn().mockResolvedValue(persisted),
    } as unknown as OplogService;

    const notified: number[] = [];
    const registry = {
      notify: (_b: string, seq: number) => notified.push(seq),
      deliverToSessions: () => [],
    };
    const fanout = { publish: vi.fn().mockResolvedValue(undefined) };

    const bus = new InProcessEventBus();
    bus.register(new OplogConsumer(oplog));
    bus.register(
      new SubscriptionNotifier(registry as never, fanout as never),
    );

    await bus.publish(makeEvent());

    expect(notified).toEqual([99]);
    expect(fanout.publish).toHaveBeenCalledWith("tenant:t1:region:north", 99);
  });
});
