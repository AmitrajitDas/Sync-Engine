import { Type, type Static } from "@sinclair/typebox";
import { BucketStateResponseSchema } from "./pullSchema.js";

/*
 * TypeBox schema for /sync/checkpoint responses.
 */
export const CheckpointResponseSchema = Type.Object({
  checkpoint: Type.Number(),
  buckets: Type.Array(Type.String()),
  bucketStates: Type.Optional(
    Type.Record(Type.String(), BucketStateResponseSchema),
  ),
});

export type CheckpointResponse = Static<typeof CheckpointResponseSchema>;
