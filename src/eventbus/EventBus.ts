import type { OplogOperation } from "../oplog/oplogSchema.js";

/*
 * Internal event contract between CDC ingestion and downstream consumers.
 *
 * A NormalizedChangeEvent is already independent of Debezium/Postgres details,
 * so consumers can focus on sync behavior: append to oplog, update caches, and
 * notify subscribers.
 */
export interface NormalizedChangeEvent {
  collection: string;
  docId: string;
  operation: OplogOperation;
  delta: Record<string, unknown> | null;
  fullDoc?: Record<string, unknown>;
  bucket: string;
  tenantId: string;
  timestamp: Date;
  origin: "server" | "client";
  clientId?: string;
  clientSeq?: number;
  cdcSourceTopic?: string;
  cdcLsn?: string;
  cdcOffset?: string;
  cdcEventId?: string;
}

// Context threads return values between priority groups. For example,
// OplogConsumer returns the persisted entry so SubscriptionNotifier can deliver
// the exact seq/doc that Mongo accepted.
export type ConsumerContext = Record<string, unknown>;

export interface EventBusConsumer {
  name: string;
  priority?: number; // SPEC-026: smaller runs first; default 100
  handle(event: NormalizedChangeEvent, ctx?: ConsumerContext): Promise<unknown>;
}

export interface EventBus {
  publish(event: NormalizedChangeEvent): Promise<void>;
  register(consumer: EventBusConsumer): void;
}
