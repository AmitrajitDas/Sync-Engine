import { describe, it, expect } from "vitest";
import * as grpc from "@grpc/grpc-js";
import { isRetryable, createGrpcCircuitBreaker } from "../../src/grpc/circuitBreaker.js";

describe("isRetryable", () => {
  it("returns false for PERMISSION_DENIED", () => {
    expect(isRetryable({ code: grpc.status.PERMISSION_DENIED } as grpc.ServiceError)).toBe(false);
  });

  it("returns false for INVALID_ARGUMENT", () => {
    expect(isRetryable({ code: grpc.status.INVALID_ARGUMENT } as grpc.ServiceError)).toBe(false);
  });

  it("returns true for UNAVAILABLE", () => {
    expect(isRetryable({ code: grpc.status.UNAVAILABLE } as grpc.ServiceError)).toBe(true);
  });

  it("returns false for non-grpc error", () => {
    expect(isRetryable(new Error("plain error"))).toBe(false);
  });
});

describe("createGrpcCircuitBreaker", () => {
  it("passes through successful calls", async () => {
    const fn = async (x: number) => x * 2;
    const breaker = createGrpcCircuitBreaker(fn);
    expect(await breaker.fire(21)).toBe(42);
  });

  it("propagates errors from wrapped function", async () => {
    const fn = async () => { throw new Error("grpc failure"); };
    const breaker = createGrpcCircuitBreaker(fn);
    await expect(breaker.fire()).rejects.toThrow("grpc failure");
  });
});
