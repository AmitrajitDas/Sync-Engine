import { Type, type Static } from "@sinclair/typebox";

/*
 * TypeBox schemas for snapshot query params and metadata frames.
 */
export const SnapshotQuerySchema = Type.Object({
  bucket: Type.String(),
  collections: Type.Optional(Type.String()),
});

export const SnapshotMetaSchema = Type.Object({
  snapshotSeq: Type.Number(),
  collections: Type.Array(Type.String()),
});

export type SnapshotQuery = Static<typeof SnapshotQuerySchema>;
export type SnapshotMeta = Static<typeof SnapshotMetaSchema>;
