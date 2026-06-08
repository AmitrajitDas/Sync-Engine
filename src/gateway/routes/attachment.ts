import type { FastifyInstance } from "fastify";
/*
 * Attachment routes.
 *
 * These are thin pass-through endpoints. The sync gateway authenticates the
 * user, then the attachment service decides URL generation and storage policy.
 */
import type { AttachmentClient } from "../../grpc/AttachmentClient.js";
import {
  PresignRequestSchema,
  PresignResponseSchema,
  DownloadUrlResponseSchema,
} from "../schemas/attachmentSchema.js";

export interface AttachmentRouteOptions {
  attachmentClient: AttachmentClient;
}

export async function attachmentRoutes(
  app: FastifyInstance,
  opts: AttachmentRouteOptions,
): Promise<void> {
  app.post(
    "/sync/attachments/presign",
    {
      schema: {
        body: PresignRequestSchema,
        response: { 200: PresignResponseSchema },
      },
    },
    async (request) => {
      const body = request.body as {
        parentType: string;
        parentId: string;
        contentType: string;
        sizeBytes: number;
      };

      return opts.attachmentClient.presign(
        {
          parentType: body.parentType,
          parentId: body.parentId,
          contentType: body.contentType,
          sizeBytes: body.sizeBytes,
        },
        request.user,
      );
    },
  );

  app.get(
    "/sync/attachments/:id/url",
    { schema: { response: { 200: DownloadUrlResponseSchema } } },
    async (request) => {
      const { id } = request.params as { id: string };
      return opts.attachmentClient.getDownloadUrl(id, request.user);
    },
  );
}
