import * as grpc from "@grpc/grpc-js";
/*
 * gRPC wrapper for RBAC authorization checks.
 *
 * Push and snapshot routes call this before allowing access. This keeps
 * authorization delegated to RBAC instead of duplicating domain permissions in
 * the sync gateway.
 */
import type { SyncUser } from "../gateway/types.js";
import type { WriteRequest } from "../sync/syncTypes.js";
import { PermissionError, DependencyUnavailableError } from "../gateway/plugins/errorHandler.js";
import { createGrpcCircuitBreaker } from "./circuitBreaker.js";
import { getRbacCheckClient, makeDeadline, makeMetadata } from "./protoLoader.js";
import type CircuitBreaker from "opossum";

export interface RbacCheckClientOptions {
  address: string;
  timeoutMs?: number;
}

type GrpcCheckClient = grpc.Client & {
  check: (
    req: unknown,
    meta: grpc.Metadata,
    opts: { deadline: Date },
    cb: (err: grpc.ServiceError | null, res: { allowed: boolean; reason?: string }) => void,
  ) => void;
};

export class RbacCheckClient {
  private readonly timeoutMs: number;
  private readonly grpcClient: GrpcCheckClient;
  private readonly checkBreaker: CircuitBreaker<[SyncUser, WriteRequest], boolean>;

  constructor(private readonly opts: RbacCheckClientOptions) {
    this.timeoutMs = opts.timeoutMs ?? 2000;
    this.grpcClient = getRbacCheckClient(opts.address, this.timeoutMs) as GrpcCheckClient;
    this.checkBreaker = createGrpcCircuitBreaker(
      (user: SyncUser, write: WriteRequest) => this._checkRaw(user, write),
      { timeout: this.timeoutMs },
    );
  }

  private _checkRaw(user: SyncUser, write: WriteRequest): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.grpcClient.check(
        {
          tenant_id: user.tenantId,
          user_id: user.sub,
          roles: user.roles,
          collection: write.collection,
          operation: write.operation,
          doc_id: write.docId,
        },
        makeMetadata(user.tenantId, user.sub),
        { deadline: makeDeadline(this.timeoutMs) },
        (err, res) => {
          if (err) {
            try { this.mapGrpcError(err); } catch (e) { reject(e); }
            return;
          }
          resolve(res.allowed);
        },
      );
    });
  }

  async check(user: SyncUser, write: WriteRequest): Promise<boolean> {
    try {
      return await this.checkBreaker.fire(user, write);
    } catch (err) {
      if (err instanceof PermissionError || err instanceof DependencyUnavailableError) throw err;
      throw new DependencyUnavailableError(`RBAC check failed: ${(err as Error).message}`);
    }
  }

  mapGrpcError(err: grpc.ServiceError): never {
    if (err.code === grpc.status.PERMISSION_DENIED) {
      throw new PermissionError("RBAC permission denied");
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
