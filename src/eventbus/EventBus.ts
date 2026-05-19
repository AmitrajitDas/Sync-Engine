export interface NormalizedChangeEvent {
  collection: string;
  docId: string;
  operation: "insert" | "update" | "delete";
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
}

export interface EventBusConsumer {
  name: string;
  handle(event: NormalizedChangeEvent): Promise<void>;
}

export interface EventBus {
  publish(event: NormalizedChangeEvent): Promise<void>;
  register(consumer: EventBusConsumer): void;
}
