import { Type, type Static } from "@sinclair/typebox";

/*
 * TypeBox schemas for client schema/version negotiation.
 */
export const SchemaQuerySchema = Type.Object({
  version: Type.Optional(Type.String()),
});

export const SchemaResponseSchema = Type.Object({
  version: Type.Number(),
  ddl: Type.Array(Type.String()),
  migrations: Type.Record(Type.String(), Type.Array(Type.String())),
  policy: Type.Union([Type.Literal("soft"), Type.Literal("forced"), Type.Literal("blocked")]),
  minSupportedVersion: Type.Number(),
});

export type SchemaResponseType = Static<typeof SchemaResponseSchema>;
