import { describe, it, expect } from "vitest";
import { parseEnv } from "../../src/config/env.js";

const REQUIRED = {
  MONGODB_URI: "mongodb://localhost:27017/test",
  REDIS_URL: "redis://localhost:6379",
  KAFKA_BROKERS: "localhost:9092",
  JWKS_URL: "http://localhost:8080/.well-known/jwks.json",
  JWT_ISSUER: "https://auth.test.local",
  RBAC_GRPC_ADDRESS: "localhost:9090",
};

describe("parseEnv", () => {
  it("applies defaults for optional vars", () => {
    const result = parseEnv(REQUIRED as NodeJS.ProcessEnv);
    expect(result.PORT).toBe(3000);
    expect(result.LOG_LEVEL).toBe("info");
    expect(result.KAFKA_CONSUMER_GROUP).toBe("sync-service");
    expect(result.KAFKA_CDC_TOPIC_PREFIX).toBe("business.cdc.public.");
    expect(result.KAFKA_TOPIC_REFRESH_INTERVAL_MS).toBe(30_000);
    expect(result.RBAC_GRPC_TIMEOUT_MS).toBe(2000);
    expect(result.OPLOG_TTL_DAYS).toBe(30);
    expect(result.PULL_DEFAULT_LIMIT).toBe(500);
    expect(result.PULL_MAX_LIMIT).toBe(1000);
  });

  it("accepts overridden values", () => {
    const result = parseEnv({ ...REQUIRED, PORT: "4000" } as NodeJS.ProcessEnv);
    expect(result.PORT).toBe(4000);
  });

  it("throws when required vars are missing", () => {
    expect(() => parseEnv({} as NodeJS.ProcessEnv)).toThrow("Invalid environment configuration");
  });

  it("throws when individual required var is missing", () => {
    const { MONGODB_URI: _, ...rest } = REQUIRED;
    expect(() => parseEnv(rest as NodeJS.ProcessEnv)).toThrow("Invalid environment configuration");
  });
});
