import type { OplogOperation } from "../oplog/oplogSchema.js";

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

// SPEC-026 — ctx threads return values between consumers in priority order.
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
