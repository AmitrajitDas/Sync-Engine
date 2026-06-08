import CircuitBreaker from "opossum";
/*
 * Shared circuit-breaker policy for outbound gRPC calls.
 *
 * Retryable dependency failures can open the breaker. Expected business errors
 * such as permission denied or invalid argument are not counted as dependency
 * health failures.
 */
import * as grpc from "@grpc/grpc-js";

// UNAVAILABLE is the only retryable gRPC status.
// PERMISSION_DENIED and INVALID_ARGUMENT must never be retried.
const NON_RETRYABLE_CODES = new Set([
  grpc.status.PERMISSION_DENIED,
  grpc.status.INVALID_ARGUMENT,
  grpc.status.NOT_FOUND,
  grpc.status.ALREADY_EXISTS,
]);

export function isRetryable(err: unknown): boolean {
  const code = (err as grpc.ServiceError)?.code;
  if (code == null) return false;
  return !NON_RETRYABLE_CODES.has(code);
}

export interface CircuitBreakerOptions {
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
}

export function createGrpcCircuitBreaker<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  opts: CircuitBreakerOptions = {},
): CircuitBreaker<T, R> {
  const breaker = new CircuitBreaker(fn, {
    timeout: opts.timeout ?? 2000,
    errorThresholdPercentage: opts.errorThresholdPercentage ?? 50,
    resetTimeout: opts.resetTimeout ?? 10_000,
    errorFilter(err) {
      // Don't count non-retryable errors towards the open threshold
      return !isRetryable(err);
    },
  });

  return breaker;
}
