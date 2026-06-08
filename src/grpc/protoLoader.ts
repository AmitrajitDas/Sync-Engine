import * as grpc from "@grpc/grpc-js";
/*
 * Dynamic proto loader for RBAC/business gRPC services.
 *
 * The generated stubs are not checked in here; instead the proto is loaded at
 * runtime and wrapped by typed client classes in this folder.
 */
import * as protoLoader from "@grpc/proto-loader";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.resolve(__dirname, "../../proto/rbac.proto");

// SPEC-030 #8 — keepalive ping timeout is unrelated to request timeout.
const KEEPALIVE_TIMEOUT_MS = 10_000;

const LOADER_OPTIONS: protoLoader.Options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [path.resolve(__dirname, "../../proto")],
};

let _packageDef: protoLoader.PackageDefinition | null = null;
let _proto: Record<string, unknown> | null = null;

function getProto(): Record<string, unknown> {
  if (!_proto) {
    _packageDef = protoLoader.loadSync(PROTO_PATH, LOADER_OPTIONS);
    _proto = grpc.loadPackageDefinition(_packageDef) as unknown as Record<string, unknown>;
  }
  return _proto;
}

type GrpcServiceConstructor = new (
  address: string,
  credentials: grpc.ChannelCredentials,
  options?: grpc.ClientOptions,
) => grpc.Client;

export function getRbacCheckClient(
  address: string,
  timeoutMs: number,
): grpc.Client {
  const proto = getProto();
  const rbac = proto["rbac"] as Record<string, GrpcServiceConstructor>;
  const ClientClass = rbac["RbacCheck"] as GrpcServiceConstructor;
  return new ClientClass(address, grpc.credentials.createInsecure(), {
    "grpc.keepalive_time_ms": 30_000,
    "grpc.keepalive_timeout_ms": KEEPALIVE_TIMEOUT_MS,
  });
}

export function getBusinessProxyClient(
  address: string,
  timeoutMs: number,
): grpc.Client {
  const proto = getProto();
  const rbac = proto["rbac"] as Record<string, GrpcServiceConstructor>;
  const ClientClass = rbac["BusinessProxy"] as GrpcServiceConstructor;
  return new ClientClass(address, grpc.credentials.createInsecure(), {
    "grpc.keepalive_time_ms": 30_000,
    "grpc.keepalive_timeout_ms": KEEPALIVE_TIMEOUT_MS,
  });
}

export function getAttachmentGrpcClient(
  address: string,
  timeoutMs: number,
): grpc.Client {
  const proto = getProto();
  const rbac = proto["rbac"] as Record<string, GrpcServiceConstructor>;
  const ClientClass = rbac["AttachmentGrpc"] as GrpcServiceConstructor;
  return new ClientClass(address, grpc.credentials.createInsecure(), {
    "grpc.keepalive_time_ms": 30_000,
    "grpc.keepalive_timeout_ms": KEEPALIVE_TIMEOUT_MS,
  });
}

export function makeDeadline(timeoutMs: number): Date {
  return new Date(Date.now() + timeoutMs);
}

export function makeMetadata(tenantId: string, userId: string): grpc.Metadata {
  const meta = new grpc.Metadata();
  meta.set("x-tenant-id", tenantId);
  meta.set("x-user-id", userId);
  return meta;
}
