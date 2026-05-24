import type { Kafka, Consumer } from "kafkajs";
import type { EventBus } from "../eventbus/EventBus.js";
import type { Logger } from "pino";
import { resolveCollectionFromTopic } from "./topicResolver.js";
import { normalizeDebeziumEnvelope, type DebeziumEnvelope } from "./postgresChangeNormalizer.js";
import {
  cdcConsumerLag,
  cdcConsumerLagSeconds,
  cdcPoisonTotal,
} from "../observability/metrics.js";

export interface DebeziumKafkaConsumerOptions {
  groupId: string;
  topicPrefix: string;
}

export interface DLQHandler {
  publish(topic: string, payload: Buffer, reason: string): Promise<void>;
}

type PoisonReason = "parse_error" | "unsupported_op" | "missing_field" | "unknown";

function classifyError(err: Error): PoisonReason {
  const msg = err.message;
  if (/Invalid JSON/i.test(msg)) return "parse_error";
  if (/Unsupported Debezium op/i.test(msg)) return "unsupported_op";
  if (/Missing /i.test(msg) || /No bucket strategy/i.test(msg)) return "missing_field";
  return "unknown";
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class DebeziumKafkaConsumer {
  private readonly consumer: Consumer;
  private readonly dlq?: DLQHandler;

  constructor(
    kafka: Kafka,
    private readonly eventBus: EventBus,
    private readonly options: DebeziumKafkaConsumerOptions,
    private readonly logger?: Logger,
    dlq?: DLQHandler,
  ) {
    this.consumer = kafka.consumer({ groupId: options.groupId });
    this.dlq = dlq;
  }

  async start(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [new RegExp(`^${escapeRegex(this.options.topicPrefix)}`)],
      fromBeginning: false,
    });

    await this.consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        if (!message.value) return;

        const raw = message.value;
        let envelope: DebeziumEnvelope;
        try {
          envelope = JSON.parse(raw.toString()) as DebeziumEnvelope;
        } catch (err) {
          await this.handlePoison(topic, raw, new Error(`Invalid JSON: ${(err as Error).message}`));
          return;
        }

        let event;
        try {
          const collection = resolveCollectionFromTopic(topic, this.options.topicPrefix);
          event = normalizeDebeziumEnvelope(envelope, collection, {
            sourceTopic: topic,
            offset: message.offset,
          });
        } catch (err) {
          await this.handlePoison(topic, raw, err as Error);
          return;
        }

        try {
          await this.eventBus.publish(event);
        } catch (err) {
          // Treat downstream failure as transient — let Kafka retry by rethrowing.
          this.logger?.error({ err, topic, partition }, "eventbus publish failed");
          throw err;
        }

        cdcConsumerLag.inc({ topic });
        if (message.timestamp) {
          const ms = Number(message.timestamp);
          if (Number.isFinite(ms)) {
            cdcConsumerLagSeconds.set({ topic }, Math.max(0, (Date.now() - ms) / 1000));
          }
        }

        this.logger?.debug({ topic, collection: event.collection, docId: event.docId }, "cdc event published");
      },
    });
  }

  private async handlePoison(topic: string, payload: Buffer, err: Error): Promise<void> {
    const reason = classifyError(err);
    cdcPoisonTotal.inc({ topic, reason });
    this.logger?.error({ err, topic, reason }, "cdc poison message");
    if (this.dlq) {
      try {
        await this.dlq.publish(topic, payload, reason);
      } catch (dlqErr) {
        this.logger?.error({ err: dlqErr, topic }, "dlq publish failed");
      }
    }
  }

  async stop(): Promise<void> {
    await this.consumer.stop();
    await this.consumer.disconnect();
    this.logger?.info("DebeziumKafkaConsumer stopped");
  }
}
