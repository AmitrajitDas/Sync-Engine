import { Type, type Static } from "@sinclair/typebox";

/*
 * TypeBox schemas for attachment URL endpoints.
 */
export const PresignRequestSchema = Type.Object({
  parentType: Type.String(),
  parentId: Type.String(),
  contentType: Type.String(),
  sizeBytes: Type.Number({ minimum: 1 }),
});

export const PresignResponseSchema = Type.Object({
  attachmentId: Type.String(),
  uploadUrl: Type.String(),
  expiresAt: Type.String(),
});

export const DownloadUrlResponseSchema = Type.Object({
  url: Type.String(),
  expiresAt: Type.String(),
});

export type PresignRequestBody = Static<typeof PresignRequestSchema>;
