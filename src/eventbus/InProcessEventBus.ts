import type {
  EventBus,
  EventBusConsumer,
  NormalizedChangeEvent,
} from "./EventBus.js";

export class EventBusPublishError extends Error {
  constructor(
    public readonly failures: Array<{ consumer: string; error: unknown }>,
  ) {
    super("One or more event bus consumers failed");
    this.name = "EventBusPublishError";
  }
}

export class InProcessEventBus implements EventBus {
  private readonly consumers = new Map<string, EventBusConsumer>();

  register(consumer: EventBusConsumer): void {
    if (this.consumers.has(consumer.name)) {
      throw new Error(
        `EventBus consumer already registered: ${consumer.name}`,
      );
    }
    this.consumers.set(consumer.name, consumer);
  }

  async publish(event: NormalizedChangeEvent): Promise<void> {
    const consumers = [...this.consumers.values()];
    if (consumers.length === 0) return;

    const results = await Promise.allSettled(
      consumers.map((consumer) => consumer.handle(event)),
    );

    const failures = results.flatMap((result, i) =>
      result.status === "rejected"
        ? [{ consumer: consumers[i].name, error: result.reason }]
        : [],
    );

    if (failures.length > 0) {
      throw new EventBusPublishError(failures);
    }
  }
}
