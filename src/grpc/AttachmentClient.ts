import * as grpc from "@grpc/grpc-js";
/*
 * gRPC wrapper for attachment URL operations.
 *
 * Sync Engine does not store blobs. It asks the attachment/RBAC service for
 * time-limited upload/download URLs scoped to the authenticated user.
 */
import type { SyncUser } from "../gateway/types.js";
import { PermissionError, DependencyUnavailableError } from "../gateway/plugins/errorHandler.js";
import { createGrpcCircuitBreaker } from "./circuitBreaker.js";
import { getAttachmentGrpcClient, makeDeadline, makeMetadata } from "./protoLoader.js";
import type CircuitBreaker from "opossum";

export interface PresignRequest {
  parentType: string;
  parentId: string;
  contentType: string;
  sizeBytes: number;
}

export interface PresignResult {
  attachmentId: string;
  uploadUrl: string;
  expiresAt: string;
}

export interface DownloadUrlResult {
  url: string;
  expiresAt: string;
}

export interface AttachmentClientOptions {
  address: string;
  timeoutMs?: number;
}

type GrpcAttachmentClient = grpc.Client & {
  presign: (
    req: unknown,
    meta: grpc.Metadata,
    opts: { deadline: Date },
    cb: (
      err: grpc.ServiceError | null,
      res: { attachment_id: string; upload_url: string; expires_at: string },
    ) => void,
  ) => void;
  getDownloadUrl: (
    req: unknown,
    meta: grpc.Metadata,
    opts: { deadline: Date },
    cb: (err: grpc.ServiceError | null, res: { url: string; expires_at: string }) => void,
  ) => void;
};

export class AttachmentClient {
  private readonly timeoutMs: number;
  private readonly grpcClient: GrpcAttachmentClient;
  private readonly presignBreaker: CircuitBreaker<[PresignRequest, SyncUser], PresignResult>;
  private readonly downloadBreaker: CircuitBreaker<[string, SyncUser], DownloadUrlResult>;

  constructor(private readonly opts: AttachmentClientOptions) {
    this.timeoutMs = (opts as AttachmentClientOptions & { timeoutMs?: number }).timeoutMs ?? 2000;
    this.grpcClient = getAttachmentGrpcClient(opts.address, this.timeoutMs) as GrpcAttachmentClient;
    this.presignBreaker = createGrpcCircuitBreaker(
      (req: PresignRequest, user: SyncUser) => this._presignRaw(req, user),
      { timeout: this.timeoutMs },
    );
    this.downloadBreaker = createGrpcCircuitBreaker(
      (id: string, user: SyncUser) => this._downloadRaw(id, user),
      { timeout: this.timeoutMs },
    );
  }

  private _presignRaw(request: PresignRequest, user: SyncUser): Promise<PresignResult> {
    return new Promise((resolve, reject) => {
      this.grpcClient.presign(
        {
          tenant_id: user.tenantId,
          user_id: user.sub,
          parent_type: request.parentType,
          parent_id: request.parentId,
          content_type: request.contentType,
          size_bytes: request.sizeBytes,
        },
        makeMetadata(user.tenantId, user.sub),
        { deadline: makeDeadline(this.timeoutMs) },
        (err, res) => {
          if (err) {
            try { this.mapGrpcError(err); } catch (e) { reject(e); }
            return;
          }
          resolve({
            attachmentId: res.attachment_id,
            uploadUrl: res.upload_url,
            expiresAt: res.expires_at,
          });
        },
      );
    });
  }

  private _downloadRaw(attachmentId: string, user: SyncUser): Promise<DownloadUrlResult> {
    return new Promise((resolve, reject) => {
      this.grpcClient.getDownloadUrl(
        { tenant_id: user.tenantId, user_id: user.sub, attachment_id: attachmentId },
        makeMetadata(user.tenantId, user.sub),
        { deadline: makeDeadline(this.timeoutMs) },
        (err, res) => {
          if (err) {
            try { this.mapGrpcError(err); } catch (e) { reject(e); }
            return;
          }
          resolve({ url: res.url, expiresAt: res.expires_at });
        },
      );
    });
  }

  async presign(request: PresignRequest, user: SyncUser): Promise<PresignResult> {
    try {
      return await this.presignBreaker.fire(request, user);
    } catch (err) {
      if (err instanceof PermissionError || err instanceof DependencyUnavailableError) throw err;
      throw new DependencyUnavailableError(`Attachment presign failed: ${(err as Error).message}`);
    }
  }

  async getDownloadUrl(attachmentId: string, user: SyncUser): Promise<DownloadUrlResult> {
    try {
      return await this.downloadBreaker.fire(attachmentId, user);
    } catch (err) {
      if (err instanceof PermissionError || err instanceof DependencyUnavailableError) throw err;
      throw new DependencyUnavailableError(`Attachment download url failed: ${(err as Error).message}`);
    }
  }

  mapGrpcError(err: grpc.ServiceError): never {
    if (err.code === grpc.status.PERMISSION_DENIED) {
      throw new PermissionError("RBAC permission denied for attachment");
    }
    if (
      err.code === grpc.status.UNAVAILABLE ||
      err.code === grpc.status.DEADLINE_EXCEEDED
    ) {
      throw new DependencyUnavailableError(`RBAC unavailable: ${err.message}`);
    }
    throw new DependencyUnavailableError(`RBAC gRPC error: ${err.message}`);
  }
}
