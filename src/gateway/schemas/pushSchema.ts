import { Type, type Static } from "@sinclair/typebox";

/*
 * TypeBox schemas for /sync/push validation and response serialization.
 */
export const WriteItemSchema = Type.Object({
  collection: Type.String(),
  docId: Type.String(),
  operation: Type.Union([
    Type.Literal("PUT"),
    Type.Literal("PATCH"),
    Type.Literal("REMOVE"),
  ]),
  payload: Type.Record(Type.String(), Type.Unknown()),
  clientTimestamp: Type.String(),
  baseSeq: Type.Number(),
  clientSeq: Type.Number(),
  idempotencyKey: Type.String(),
});

export const PushRequestSchema = Type.Object({
  clientId: Type.String(),
  writes: Type.Array(WriteItemSchema),
});

export const WriteResultSchema = Type.Object({
  docId: Type.String(),
  status: Type.Union([
    Type.Literal("applied"),
    Type.Literal("rejected"),
    Type.Literal("conflict"),
  ]),
  serverSeq: Type.Optional(Type.Number()),
  writeCheckpoint: Type.Optional(Type.Number()),
  serverVersion: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  reason: Type.Optional(Type.String()),
});

export const PushResponseSchema = Type.Object({
  results: Type.Array(WriteResultSchema),
  checkpoint: Type.Number(),
});

export type PushRequest = Static<typeof PushRequestSchema>;
export type PushResponse = Static<typeof PushResponseSchema>;
