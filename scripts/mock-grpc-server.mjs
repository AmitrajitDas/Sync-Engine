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
import { Pool } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.resolve(__dirname, "../proto/rbac.proto");
const PORT = process.env.GRPC_PORT ?? "9090";
const RBAC_ALLOW = process.env.RBAC_ALLOW !== "false";
const APPLY_STATUS = process.env.APPLY_STATUS ?? "applied";
const PG_WRITE_THROUGH_URL = process.env.PG_WRITE_THROUGH_URL;
const writeThroughPool = PG_WRITE_THROUGH_URL
  ? new Pool({ connectionString: PG_WRITE_THROUGH_URL })
  : null;

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

function fromProtoValue(value) {
  if (!value || typeof value !== "object") return value;
  if (value.null_value != null || value.nullValue != null) return null;
  if (value.number_value != null) return value.number_value;
  if (value.numberValue != null) return value.numberValue;
  if (value.string_value != null) return value.string_value;
  if (value.stringValue != null) return value.stringValue;
  if (value.bool_value != null) return value.bool_value;
  if (value.boolValue != null) return value.boolValue;
  if (value.struct_value) return fromProtoStruct(value.struct_value);
  if (value.structValue) return fromProtoStruct(value.structValue);
  if (value.list_value) return (value.list_value.values ?? []).map(fromProtoValue);
  if (value.listValue) return (value.listValue.values ?? []).map(fromProtoValue);
  return undefined;
}

function fromProtoStruct(struct) {
  return Object.fromEntries(
    Object.entries(struct?.fields ?? {}).map(([key, value]) => [key, fromProtoValue(value)]),
  );
}

async function persistFarmWrite(request) {
  if (!writeThroughPool || request.collection !== "farms") return;

  const {
    operation,
    doc_id,
    tenant_id,
    user_id,
    client_id,
    client_seq,
    payload: rawPayload = {},
  } = request;
  const payload = rawPayload?.fields ? fromProtoStruct(rawPayload) : rawPayload;

  if (operation === "REMOVE") {
    await writeThroughPool.query(
      "DELETE FROM farms WHERE id = $1 AND tenant_id = $2",
      [doc_id, tenant_id],
    );
    return;
  }

  const existing = await writeThroughPool.query(
    "SELECT * FROM farms WHERE id = $1 AND tenant_id = $2",
    [doc_id, tenant_id],
  );
  const merged = { ...(existing.rows[0] ?? {}), ...payload };
  if (!merged.region || !merged.name) {
    throw new Error("Mock write-through farms PUT/PATCH requires region and name");
  }

  await writeThroughPool.query(
    `INSERT INTO farms
       (id, tenant_id, region, name, area_ha, created_by, client_id, client_seq, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, NOW()), NOW())
     ON CONFLICT (id) DO UPDATE SET
       region = EXCLUDED.region,
       name = EXCLUDED.name,
       area_ha = EXCLUDED.area_ha,
       created_by = EXCLUDED.created_by,
       client_id = EXCLUDED.client_id,
       client_seq = EXCLUDED.client_seq,
       updated_at = NOW()`,
    [
      doc_id,
      tenant_id,
      merged.region,
      merged.name,
      merged.area_ha ?? null,
      merged.created_by ?? user_id,
      client_id || null,
      client_seq || null,
      merged.created_at ?? null,
    ],
  );
}

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
  async ApplyWrite(call, callback) {
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
      try {
        await persistFarmWrite(call.request);
      } catch (err) {
        console.error("[PROXY] Postgres write-through failed:", err);
        callback({
          code: grpc.status.INTERNAL,
          message: `Mock Postgres write-through failed: ${err.message}`,
        });
        return;
      }
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
  console.log(`  PG_WRITE_THROUGH=${writeThroughPool ? "enabled" : "disabled"}`);
});
