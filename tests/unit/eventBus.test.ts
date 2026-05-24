import { describe, it, expect } from "vitest";
import { InProcessEventBus, EventBusPublishError } from "../../src/eventbus/InProcessEventBus.js";
import type { EventBusConsumer, NormalizedChangeEvent } from "../../src/eventbus/EventBus.js";

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

describe("InProcessEventBus priority ordering", () => {
  it("runs lower-priority consumers before higher", async () => {
    const order: string[] = [];
    const bus = new InProcessEventBus();
    const low: EventBusConsumer = {
      name: "low",
      priority: 10,
      async handle() {
        order.push("low");
        return { seq: 7 };
      },
    };
    const high: EventBusConsumer = {
      name: "high",
      priority: 50,
      async handle() {
        order.push("high");
      },
    };
    bus.register(high);
    bus.register(low);
    await bus.publish(makeEvent());
    expect(order).toEqual(["low", "high"]);
  });

  it("threads earlier consumer return into ctx", async () => {
    const bus = new InProcessEventBus();
    let seen: unknown;
    bus.register({
      name: "oplog",
      priority: 10,
      async handle() {
        return { seq: 42 };
      },
    });
    bus.register({
      name: "later",
      priority: 50,
      async handle(_e, ctx) {
        seen = ctx?.oplogResult;
      },
    });
    await bus.publish(makeEvent());
    expect(seen).toEqual({ seq: 42 });
  });

  it("lower-priority failure aborts higher-priority", async () => {
    const bus = new InProcessEventBus();
    let highRan = false;
    bus.register({
      name: "low",
      priority: 10,
      async handle() {
        throw new Error("boom");
      },
    });
    bus.register({
      name: "high",
      priority: 50,
      async handle() {
        highRan = true;
      },
    });
    await expect(bus.publish(makeEvent())).rejects.toBeInstanceOf(EventBusPublishError);
    expect(highRan).toBe(false);
  });
});
