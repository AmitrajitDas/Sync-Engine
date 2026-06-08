import * as grpc from "@grpc/grpc-js";
/*
 * gRPC wrapper for business writes.
 *
 * /sync/push never writes business tables directly. It sends cleaned and
 * authorized writes here, then Postgres/Debezium eventually reflects the change
 * back into the sync oplog.
 */
import type { SyncUser } from "../gateway/types.js";
import type { WriteRequest } from "../sync/syncTypes.js";
import { DependencyUnavailableError } from "../gateway/plugins/errorHandler.js";
import { createGrpcCircuitBreaker } from "./circuitBreaker.js";
import { getBusinessProxyClient, makeDeadline, makeMetadata } from "./protoLoader.js";
import type CircuitBreaker from "opossum";

export interface ApplyWriteResult {
  docId: string;
  serverSeq?: number;
  writeCheckpoint?: number;
  status: "applied" | "rejected";
  reason?: string;
}

export interface BusinessProxyClientOptions {
  address: string;
  timeoutMs?: number;
}

type GrpcBusinessClient = grpc.Client & {
  applyWrite: (
    req: unknown,
    meta: grpc.Metadata,
    opts: { deadline: Date },
    cb: (
      err: grpc.ServiceError | null,
      res: {
        status: string;
        doc_id: string;
        server_seq: string;
        reason: string;
        write_checkpoint?: string;
      },
    ) => void,
  ) => void;
};

interface ProtoStruct {
  fields: Record<string, ProtoValue>;
}

type ProtoValue =
  | { nullValue: 0 }
  | { numberValue: number }
  | { stringValue: string }
  | { boolValue: boolean }
  | { structValue: ProtoStruct }
  | { listValue: { values: ProtoValue[] } };

function toProtoValue(value: unknown): ProtoValue {
  if (value === null || value === undefined) return { nullValue: 0 };
  if (typeof value === "number") return { numberValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  if (Array.isArray(value)) {
    return { listValue: { values: value.map(toProtoValue) } };
  }
  return { structValue: toProtoStruct(value as Record<string, unknown>) };
}

export function toProtoStruct(value: Record<string, unknown>): ProtoStruct {
  return {
    fields: Object.fromEntries(
      Object.entries(value).map(([key, fieldValue]) => [key, toProtoValue(fieldValue)]),
    ),
  };
}

export interface ApplyWriteArgs {
  write: WriteRequest;
  user: SyncUser;
  clientId: string;
}

export class BusinessProxyClient {
  private readonly timeoutMs: number;
  private readonly grpcClient: GrpcBusinessClient;
  private readonly applyBreaker: CircuitBreaker<[ApplyWriteArgs], ApplyWriteResult>;
  private warnedMissingCheckpoint = false;

  constructor(private readonly opts: BusinessProxyClientOptions) {
    this.timeoutMs = opts.timeoutMs ?? 2000;
    this.grpcClient = getBusinessProxyClient(opts.address, this.timeoutMs) as GrpcBusinessClient;
    this.applyBreaker = createGrpcCircuitBreaker(
      (args: ApplyWriteArgs) => this._applyWriteRaw(args),
      { timeout: this.timeoutMs },
    );
  }

  // increment inflight counter (used by SPEC-030 graceful shutdown)
  private _inflight = 0;
  get inflightCount(): number {
    return this._inflight;
  }

  private _applyWriteRaw(args: ApplyWriteArgs): Promise<ApplyWriteResult> {
    const { write, user, clientId } = args;
    return new Promise((resolve, reject) => {
      this.grpcClient.applyWrite(
        {
          tenant_id: user.tenantId,
          user_id: user.sub,
          roles: user.roles,
          collection: write.collection,
          operation: write.operation,
          doc_id: write.docId,
          // google.protobuf.Struct must be encoded using its fields/value shape;
          // passing a plain JS object silently serializes as an empty Struct.
          payload: toProtoStruct(write.payload),
          idempotency_key: write.idempotencyKey,
          client_id: clientId,
          client_seq: write.clientSeq,
          base_seq: write.baseSeq,
        },
        makeMetadata(user.tenantId, user.sub),
        { deadline: makeDeadline(this.timeoutMs) },
        (err, res) => {
          if (err) {
            if (
              err.code === grpc.status.PERMISSION_DENIED ||
              err.code === grpc.status.INVALID_ARGUMENT
            ) {
              resolve(this.mapGrpcError(err, write.docId));
            } else {
              reject(new DependencyUnavailableError(`RBAC unavailable: ${err.message}`));
            }
            return;
          }
          const serverSeq = res.server_seq ? Number(res.server_seq) : undefined;
          let writeCheckpoint: number | undefined;
          if (res.write_checkpoint) {
            writeCheckpoint = Number(res.write_checkpoint);
          } else {
            if (!this.warnedMissingCheckpoint) {
              this.warnedMissingCheckpoint = true;
              // eslint-disable-next-line no-console
              console.warn("BusinessProxy response missing write_checkpoint; falling back to server_seq");
            }
            writeCheckpoint = serverSeq;
          }
          resolve({
            docId: res.doc_id,
            status: res.status === "applied" ? "applied" : "rejected",
            serverSeq,
            writeCheckpoint,
            reason: res.reason || undefined,
          });
        },
      );
    });
  }

  async applyWrite(
    write: WriteRequest,
    user: SyncUser,
    clientId: string,
  ): Promise<ApplyWriteResult> {
    this._inflight++;
    try {
      return await this.applyBreaker.fire({ write, user, clientId });
    } catch (err) {
      if (err instanceof DependencyUnavailableError) throw err;
      const grpcErr = err as grpc.ServiceError;
      if (grpcErr.code === grpc.status.PERMISSION_DENIED) {
        return { docId: write.docId, status: "rejected", reason: "Permission denied" };
      }
      if (grpcErr.code === grpc.status.INVALID_ARGUMENT) {
        return { docId: write.docId, status: "rejected", reason: grpcErr.message };
      }
      throw new DependencyUnavailableError(`BusinessProxy failed: ${(err as Error).message}`);
    } finally {
      this._inflight--;
    }
  }

  mapGrpcError(err: grpc.ServiceError, docId: string): ApplyWriteResult {
    if (err.code === grpc.status.PERMISSION_DENIED) {
      return { docId, status: "rejected", reason: "Permission denied" };
    }
    if (err.code === grpc.status.INVALID_ARGUMENT) {
      return { docId, status: "rejected", reason: err.message };
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
