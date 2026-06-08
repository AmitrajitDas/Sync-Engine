import type {
  ConsumerContext,
  EventBus,
  EventBusConsumer,
  NormalizedChangeEvent,
} from "./EventBus.js";

/*
 * Simple priority-aware in-process event bus.
 *
 * It is deliberately not Kafka/Rabbit/etc. CDC already uses Kafka at the
 * boundary; once a message reaches this process, consumers are just ordered
 * side effects that must happen before Kafka offset acknowledgement.
 */
const DEFAULT_PRIORITY = 100;

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

  // SPEC-026 — group by priority asc; each group runs in parallel; lower-priority
  // failure aborts higher-priority. Returns from earlier consumers thread to later
  // consumers via ctx[`${consumer.name}Result`].
  async publish(event: NormalizedChangeEvent): Promise<void> {
    const consumers = [...this.consumers.values()];
    if (consumers.length === 0) return;

    const groups = new Map<number, EventBusConsumer[]>();
    for (const c of consumers) {
      const p = c.priority ?? DEFAULT_PRIORITY;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p)!.push(c);
    }
    const priorities = [...groups.keys()].sort((a, b) => a - b);

    const ctx: ConsumerContext = {};

    for (const p of priorities) {
      const group = groups.get(p)!;
      const results = await Promise.allSettled(
        group.map((c) => c.handle(event, ctx)),
      );
      const failures = results.flatMap((r, i) =>
        r.status === "rejected" ? [{ consumer: group[i].name, error: r.reason }] : [],
      );
      if (failures.length > 0) {
        throw new EventBusPublishError(failures);
      }
      for (let i = 0; i < group.length; i++) {
        const r = results[i];
        if (r.status === "fulfilled" && r.value !== undefined) {
          ctx[`${group[i].name}Result`] = r.value;
        }
      }
    }
  }
}
