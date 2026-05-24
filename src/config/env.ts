import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),

  KAFKA_BROKERS: z.string().min(1),
  KAFKA_CONSUMER_GROUP: z.string().default("sync-service"),
  KAFKA_CDC_TOPIC_PREFIX: z.string().default("business.cdc.public."),

  JWKS_URL: z.string().url(),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().optional(),

  RBAC_GRPC_ADDRESS: z.string().min(1),
  RBAC_GRPC_TIMEOUT_MS: z.coerce.number().default(2000),

  OPLOG_TTL_DAYS: z.coerce.number().default(30),
  PULL_DEFAULT_LIMIT: z.coerce.number().default(500),
  PULL_MAX_LIMIT: z.coerce.number().default(1000),

  PG_READ_REPLICA_URL: z.string().optional(),

  SCHEMA_ROLLOUT_PERCENT: z.coerce.number().min(0).max(100).default(100),
  SCHEMA_MIN_SUPPORTED_VERSION: z.coerce.number().default(1),
  SCHEMA_KILL_SWITCH: z.coerce.boolean().default(false),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${result.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`
    );
  }
  return result.data;
}

