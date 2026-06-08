import type { FastifyInstance, FastifyError } from "fastify";
/*
 * Central HTTP error mapping.
 *
 * Domain/service code throws typed errors, and this plugin turns them into a
 * stable API response shape. Unknown errors are logged and hidden from clients.
 */
import fp from "fastify-plugin";

export class AuthError extends Error {
  readonly statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class ValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class PermissionError extends Error {
  readonly statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

export class DependencyUnavailableError extends Error {
  readonly statusCode = 503;
  constructor(message: string) {
    super(message);
    this.name = "DependencyUnavailableError";
  }
}

export type SyncError =
  | AuthError
  | ValidationError
  | ConflictError
  | PermissionError
  | DependencyUnavailableError;

function isSyncError(err: unknown): err is SyncError {
  return (
    err instanceof AuthError ||
    err instanceof ValidationError ||
    err instanceof ConflictError ||
    err instanceof PermissionError ||
    err instanceof DependencyUnavailableError
  );
}

export const errorHandlerPlugin = fp(async function errorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | Error, _req, reply) => {
    if (isSyncError(err)) {
      return reply.status(err.statusCode).send({ error: err.name, message: err.message });
    }

    const fastifyErr = err as FastifyError;
    if (fastifyErr.statusCode) {
      return reply.status(fastifyErr.statusCode).send({ error: "RequestError", message: err.message });
    }

    app.log.error(err, "unhandled error");
    return reply.status(500).send({ error: "InternalServerError", message: "An unexpected error occurred" });
  });
});
