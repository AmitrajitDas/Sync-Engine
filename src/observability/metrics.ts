/*
 * Prometheus metric definitions.
 *
 * Routes and infrastructure modules import these metric objects directly and
 * increment/observe them at the point where the event happens.
 */
import {
  Registry,
  Histogram,
  Counter,
  Gauge,
  collectDefaultMetrics,
} from "prom-client";

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new Histogram({
  name: "sync_http_request_duration_seconds",
  help: "HTTP request duration in seconds by route and status",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const pullEntriesReturned = new Histogram({
  name: "sync_pull_entries_returned",
  help: "Number of oplog entries returned per pull request",
  labelNames: ["tenant_id"],
  buckets: [0, 10, 50, 100, 250, 500, 1000],
  registers: [registry],
});

export const oplogQueryTotal = new Counter({
  name: "sync_oplog_query_total",
  help: "Total oplog queries",
  labelNames: ["collection"],
  registers: [registry],
});

export const conflictTotal = new Counter({
  name: "sync_conflict_total",
  help: "Total conflict events per collection and outcome",
  labelNames: ["collection", "outcome"],
  registers: [registry],
});

export const grpcRequestDuration = new Histogram({
  name: "sync_grpc_request_duration_seconds",
  help: "gRPC call duration in seconds by method and status",
  labelNames: ["method", "status"],
  buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2],
  registers: [registry],
});

export const cdcConsumerLag = new Counter({
  name: "sync_cdc_consumer_lag_total",
  help: "Number of CDC messages processed",
  labelNames: ["topic"],
  registers: [registry],
});

// SPEC-029
export const cdcConsumerLagSeconds = new Gauge({
  name: "sync_cdc_consumer_lag_seconds",
  help: "Estimated CDC consumer lag in seconds (now - message.timestamp)",
  labelNames: ["topic"],
  registers: [registry],
});

export const cdcPoisonTotal = new Counter({
  name: "sync_cdc_poison_total",
  help: "Total poisoned CDC messages (parse, missing field, etc.)",
  labelNames: ["topic", "reason"],
  registers: [registry],
});

// SPEC-032
export const bucketChecksumMismatchTotal = new Counter({
  name: "sync_bucket_checksum_mismatch_total",
  help: "Per-bucket checksum mismatches detected on pull/checkpoint",
  labelNames: ["bucket"],
  registers: [registry],
});

// SPEC-033
export const pullPriorityBucketTotal = new Counter({
  name: "sync_pull_priority_bucket_total",
  help: "Pull requests filtered by priorityMax",
  labelNames: ["priority"],
  registers: [registry],
});

// SPEC-034
export const streamActiveConnections = new Gauge({
  name: "sync_stream_active_connections",
  help: "Active WebSocket /sync/stream connections",
  registers: [registry],
});

export const streamFrameTotal = new Counter({
  name: "sync_stream_frame_total",
  help: "Server→client stream frames emitted",
  labelNames: ["type"],
  registers: [registry],
});

export const streamBackpressurePausedTotal = new Counter({
  name: "sync_stream_backpressure_paused_total",
  help: "Times a stream session paused waiting for client ack",
  registers: [registry],
});

export const schemaVersionRequests = new Counter({
  name: "sync_client_schema_version_total",
  help: "Schema endpoint requests by reported client version",
  labelNames: ["version"],
  registers: [registry],
});
