import type { FastifyInstance, FastifyReply } from "fastify";
/*
 * GET /sync/schema
 *
 * Mobile clients use this endpoint to learn the local SQLite schema, migrations,
 * and whether their current schema version is still allowed to sync.
 */
import { getSchemaResponse } from "../../sync/clientSchema.js";
import { ValidationError } from "../plugins/errorHandler.js";
import { SchemaResponseSchema } from "../schemas/schemaSchema.js";
import { schemaVersionRequests } from "../../observability/metrics.js";
import type { SchemaEnv } from "../../app.js";
import { Type } from "@sinclair/typebox";

export interface SchemaRouteOptions {
  schemaEnv?: SchemaEnv;
}

export async function schemaRoutes(
  app: FastifyInstance,
  opts: SchemaRouteOptions = {},
): Promise<void> {
  app.get(
    "/sync/schema",
    {
      schema: {
        response: {
          200: SchemaResponseSchema,
          426: Type.Object({ error: Type.String(), message: Type.String(), minSupportedVersion: Type.Number() }),
        },
      },
    },
    async (request, reply: FastifyReply) => {
      const query = request.query as { version?: string };

      let clientVersion: number | undefined;
      if (query.version !== undefined) {
        clientVersion = Number(query.version);
        if (!Number.isInteger(clientVersion) || clientVersion < 0) {
          throw new ValidationError(`Invalid version parameter: ${query.version}`);
        }
      }

      schemaVersionRequests.inc({ version: String(clientVersion ?? "unknown") });

      const ctx = {
        rolloutPercent: opts.schemaEnv?.rolloutPercent,
        minSupportedVersion: opts.schemaEnv?.minSupportedVersion,
        killSwitch: opts.schemaEnv?.killSwitch,
        clientKey: request.id,
      };

      let response;
      try {
        response = getSchemaResponse(clientVersion, ctx);
      } catch (err) {
        if (err instanceof RangeError) {
          throw new ValidationError(err.message);
        }
        throw err;
      }

      if (response.policy === "blocked") {
        void reply.status(426).send({
          error: "UpgradeRequired",
          message: `Client version ${clientVersion ?? 0} is no longer supported. Please reinstall.`,
          minSupportedVersion: response.minSupportedVersion,
        });
        return;
      }

      return response;
    },
  );
}
