/**
 * Mock gRPC server for RbacCheck, BusinessProxy, AttachmentGrpc.
 * Implements all methods; behavior configurable via env vars.
 *
 * Usage:
 *   node scripts/mock-grpc-server.mjs
 *
 * Env vars:
 *   GRPC_PORT=9090          (default)
 *   RBAC_ALLOW=true|false   (default: true)
 *   APPLY_STATUS=applied|rejected (default: applied)
 */

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { fileURLToPath } from "url";
import path from "path";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.resolve(__dirname, "../proto/rbac.proto");
const PORT = process.env.GRPC_PORT ?? "9090";
const RBAC_ALLOW = process.env.RBAC_ALLOW !== "false";
const APPLY_STATUS = process.env.APPLY_STATUS ?? "applied";

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [path.resolve(__dirname, "../proto")],
});
const proto = grpc.loadPackageDefinition(packageDef);
const rbac = proto.rbac;

let serverSeqCounter = 100;

// RbacCheck handlers
const rbacCheckImpl = {
  Check(call, callback) {
    const { collection, operation, user_id } = call.request;
    console.log(`[RBAC] Check: ${user_id} ${operation} on ${collection} → ${RBAC_ALLOW ? "allowed" : "denied"}`);
    callback(null, {
      allowed: RBAC_ALLOW,
      reason: RBAC_ALLOW ? "" : "Permission denied by mock",
    });
  },
  CheckBatch(call, callback) {
    const results = (call.request.checks ?? []).map((c) => ({
      allowed: RBAC_ALLOW,
      reason: RBAC_ALLOW ? "" : "denied",
    }));
    callback(null, { results });
  },
};

// BusinessProxy handlers
const businessProxyImpl = {
  ApplyWrite(call, callback) {
    const { collection, doc_id, operation, user_id } = call.request;
    serverSeqCounter++;
    const seq = serverSeqCounter;
    console.log(`[PROXY] ApplyWrite: ${user_id} ${operation} ${collection}/${doc_id} → ${APPLY_STATUS} (seq=${seq})`);
    if (APPLY_STATUS === "rejected") {
      callback(null, {
        status: "rejected",
        doc_id,
        server_seq: String(seq),
        write_checkpoint: String(seq),
        reason: "Rejected by mock",
      });
    } else {
      callback(null, {
        status: "applied",
        doc_id,
        server_seq: String(seq),
        write_checkpoint: String(seq),
        reason: "",
      });
    }
  },
};

// AttachmentGrpc handlers
const attachmentImpl = {
  Presign(call, callback) {
    const { parent_type, parent_id, content_type } = call.request;
    const id = `att-${randomUUID()}`;
    console.log(`[ATTACH] Presign: ${parent_type}/${parent_id} ${content_type}`);
    callback(null, {
      attachment_id: id,
      upload_url: `https://minio.local/bucket/${id}?upload=1`,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
  },
  GetDownloadUrl(call, callback) {
    const { attachment_id } = call.request;
    console.log(`[ATTACH] GetDownloadUrl: ${attachment_id}`);
    callback(null, {
      url: `https://minio.local/bucket/${attachment_id}?download=1`,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
  },
};

const server = new grpc.Server();
server.addService(rbac.RbacCheck.service, rbacCheckImpl);
server.addService(rbac.BusinessProxy.service, businessProxyImpl);
server.addService(rbac.AttachmentGrpc.service, attachmentImpl);

server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
  if (err) {
    console.error("Failed to bind:", err);
    process.exit(1);
  }
  console.log(`\nMock gRPC server listening on port ${port}`);
  console.log(`  RBAC_ALLOW=${RBAC_ALLOW}`);
  console.log(`  APPLY_STATUS=${APPLY_STATUS}`);
});
