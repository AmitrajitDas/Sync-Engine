import type { Admin, Consumer, EachMessagePayload, Kafka } from "kafkajs";
/*
 * Kafka/Debezium ingestion boundary.
 *
 * This class subscribes to Debezium topics, parses each message, normalizes the
 * database-specific envelope into the Sync Engine event shape, then publishes
 * that event to the in-process EventBus. Poison messages are counted/logged and
 * optionally sent to a DLQ; downstream failures are rethrown so Kafka can retry.
 */
import type { EventBus } from "../eventbus/EventBus.js";
import type { Logger } from "pino";
import { filterTopicsByPrefix, resolveCollectionFromTopic } from "./topicResolver.js";
import { normalizeDebeziumEnvelope, type DebeziumEnvelope } from "./postgresChangeNormalizer.js";
import {
  cdcConsumerLag,
  cdcConsumerLagSeconds,
  cdcPoisonTotal,
} from "../observability/metrics.js";

export interface DebeziumKafkaConsumerOptions {
  groupId: string;
  topicPrefix: string;
  topicRefreshIntervalMs?: number;
}

export interface DLQHandler {
  publish(topic: string, payload: Buffer, reason: string): Promise<void>;
}

type PoisonReason = "parse_error" | "unsupported_op" | "missing_field" | "unknown";

interface KafkaConnectJsonEnvelope {
  schema?: unknown;
  payload?: DebeziumEnvelope | null;
}

function unwrapKafkaConnectEnvelope(parsed: unknown): DebeziumEnvelope | null {
  if (parsed === null) return null;
  if (typeof parsed !== "object") {
    throw new Error("Invalid JSON: expected an object");
  }
  if ("payload" in parsed) {
    return (parsed as KafkaConnectJsonEnvelope).payload ?? null;
  }
  return parsed as DebeziumEnvelope;
}

function classifyError(err: Error): PoisonReason {
  const msg = err.message;
  if (/Invalid JSON/i.test(msg)) return "parse_error";
  if (/Unsupported Debezium op/i.test(msg)) return "unsupported_op";
  if (/Missing /i.test(msg) || /No bucket strategy/i.test(msg)) return "missing_field";
  return "unknown";
}

const DEFAULT_TOPIC_REFRESH_INTERVAL_MS = 30_000;

export class DebeziumKafkaConsumer {
  private readonly consumer: Consumer;
  private readonly admin: Admin;
  private readonly dlq?: DLQHandler;
  private readonly subscribedTopics = new Set<string>();
  private topicRefreshTimer?: NodeJS.Timeout;
  private consumerRunning = false;
  private refreshInProgress = false;
  private stopping = false;

  constructor(
    kafka: Kafka,
    private readonly eventBus: EventBus,
    private readonly options: DebeziumKafkaConsumerOptions,
    private readonly logger?: Logger,
    dlq?: DLQHandler,
  ) {
    this.consumer = kafka.consumer({ groupId: options.groupId });
    this.admin = kafka.admin();
    this.dlq = dlq;
  }

  async start(): Promise<void> {
    await this.consumer.connect();
    await this.admin.connect();

    const initialTopics = await this.listMatchingTopics();
    if (initialTopics.length > 0) {
      await this.subscribeToTopics(initialTopics, false);
      await this.runConsumer();
    } else {
      this.logger?.warn(
        { topicPrefix: this.options.topicPrefix },
        "no CDC topics found yet; waiting for Debezium topics to appear",
      );
    }

    this.startTopicDiscovery();
  }

  private async runConsumer(): Promise<void> {
    if (this.consumerRunning || this.subscribedTopics.size === 0) return;
    await this.consumer.run({ eachMessage: this.handleMessage });
    this.consumerRunning = true;
  }

  private startTopicDiscovery(): void {
    const intervalMs = this.options.topicRefreshIntervalMs ?? DEFAULT_TOPIC_REFRESH_INTERVAL_MS;
    this.topicRefreshTimer = setInterval(() => {
      void this.refreshTopicSubscriptions();
    }, intervalMs);
    this.topicRefreshTimer.unref?.();
  }

  private async listMatchingTopics(): Promise<string[]> {
    const topics = await this.admin.listTopics();
    return filterTopicsByPrefix(topics, this.options.topicPrefix);
  }

  private async subscribeToTopics(topics: string[], fromBeginning: boolean): Promise<void> {
    if (topics.length === 0) return;
    await this.consumer.subscribe({ topics, fromBeginning });
    for (const topic of topics) this.subscribedTopics.add(topic);
    this.logger?.info({ topics, fromBeginning }, "subscribed to CDC topics");
  }

  private async refreshTopicSubscriptions(): Promise<void> {
    if (this.stopping || this.refreshInProgress) return;

    this.refreshInProgress = true;
    try {
      const matchingTopics = await this.listMatchingTopics();
      const newTopics = matchingTopics.filter((topic) => !this.subscribedTopics.has(topic));
      if (newTopics.length === 0) return;

      if (this.consumerRunning) {
        await this.consumer.stop();
        this.consumerRunning = false;
      }

      await this.subscribeToTopics(newTopics, true);
      await this.runConsumer();
    } catch (err) {
      this.logger?.error({ err }, "cdc topic discovery failed");
    } finally {
      this.refreshInProgress = false;
    }
  }

  private handleMessage = async ({ topic, partition, message }: EachMessagePayload): Promise<void> => {
    if (!message.value) return;

    const raw = message.value;
    let envelope: DebeziumEnvelope;
    try {
      const parsed = JSON.parse(raw.toString()) as unknown;
      const unwrapped = unwrapKafkaConnectEnvelope(parsed);
      // Kafka Connect may emit null tombstone values during log compaction.
      if (!unwrapped) return;
      envelope = unwrapped;
    } catch (err) {
      await this.handlePoison(topic, raw, new Error(`Invalid JSON: ${(err as Error).message}`));
      return;
    }

    let event;
    try {
      // Topic naming determines the logical collection. The row payload
      // determines document id, tenant, bucket, operation, and delta.
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
      // Oplog persistence/notification failures are transient from Kafka's
      // perspective. Rethrow so this message is not acknowledged as handled.
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
    this.stopping = true;
    if (this.topicRefreshTimer) clearInterval(this.topicRefreshTimer);
    if (this.consumerRunning) {
      await this.consumer.stop();
      this.consumerRunning = false;
    }
    await this.consumer.disconnect();
    await this.admin.disconnect();
    this.logger?.info("DebeziumKafkaConsumer stopped");
  }
}
