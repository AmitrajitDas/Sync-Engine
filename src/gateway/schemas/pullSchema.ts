import { Type, type Static } from "@sinclair/typebox";

export const BucketStateSchema = Type.Object({
  seq: Type.Number(),
  csum: Type.Number(),
});

export const BucketStateResponseSchema = Type.Object({
  seq: Type.Number(),
  csum: Type.Number(),
  mismatch: Type.Optional(Type.Boolean()),
});

export const PullRequestSchema = Type.Object({
  checkpoint: Type.Optional(Type.Number({ default: 0 })),
  limit: Type.Optional(Type.Number()),
  collections: Type.Optional(Type.Array(Type.String())),
  // SPEC-032
  bucketStates: Type.Optional(
    Type.Record(Type.String(), BucketStateSchema),
  ),
  // SPEC-033
  priorityMax: Type.Optional(Type.Number()),
});

export const PullEntrySchema = Type.Object({
  seq: Type.Number(),
  collection: Type.String(),
  docId: Type.String(),
  operation: Type.Union([
    Type.Literal("PUT"),
    Type.Literal("PATCH"),
    Type.Literal("REMOVE"),
    Type.Literal("MOVE"),
    Type.Literal("CLEAR"),
  ]),
  delta: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  fullDoc: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  bucket: Type.String(),
  tenantId: Type.String(),
  timestamp: Type.String(),
  priority: Type.Optional(Type.Number()),
});

export const PullResponseSchema = Type.Object({
  entries: Type.Array(PullEntrySchema),
  checkpoint: Type.Number(),
  hasMore: Type.Boolean(),
  bucketStates: Type.Optional(
    Type.Record(Type.String(), BucketStateResponseSchema),
  ),
});

export type PullRequest = Static<typeof PullRequestSchema>;
export type PullResponse = Static<typeof PullResponseSchema>;
