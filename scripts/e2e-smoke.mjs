import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { Pool } from "pg";
import WebSocket from "ws";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:3000";
const JWKS_TEST_URL = process.env.JWKS_TEST_URL ?? "http://127.0.0.1:4001";
const POSTGRES_URL =
  process.env.PG_WRITE_THROUGH_URL ?? "postgres://rbac:rbac@127.0.0.1:5432/rbac";
const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/sync";

const runId = randomUUID().slice(0, 8);
const userId = `e2e-user-${runId}`;
const tenantId = `e2e-tenant-${runId}`;
const clientId = `e2e-device-${runId}`;
const region = "west";
const regionBucket = `tenant:${tenantId}:region:${region}`;
const userBucket = `tenant:${tenantId}:user:${userId}`;

const pg = new Pool({ connectionString: POSTGRES_URL });
const mongo = new MongoClient(MONGODB_URI);
await mongo.connect();
const oplog = mongo.db().collection("oplog");

const results = [];
let token;
let pushedFarmEntry;

async function run(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: err });
    console.error(`FAIL ${name}: ${err.message}`);
  }
}

async function request(path, options = {}, auth = true) {
  const headers = {
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(auth && token ? { authorization: `Bearer ${token}` } : {}),
    ...(options.headers ?? {}),
  };
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep non-JSON responses such as NDJSON snapshots and Prometheus metrics.
  }
  return { response, body, text };
}

async function waitForPull(collection, docId, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { response, body } = await request("/sync/pull", {
      method: "POST",
      body: JSON.stringify({ checkpoint: 0, collections: [collection], limit: 100 }),
    });
    assert.equal(response.status, 200);
    const entry = body.entries.find((item) => item.docId === docId);
    if (entry) return entry;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${collection}/${docId} through /sync/pull`);
}

function openWebSocket(path, onOpen) {
  return new Promise((resolve, reject) => {
    const wsUrl = `${API_URL.replace(/^http/, "ws")}${path}`;
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`WebSocket timed out: ${path}`));
    }, 5_000);

    ws.once("open", () => {
      try {
        onOpen?.(ws);
      } catch (err) {
        clearTimeout(timer);
        ws.terminate();
        reject(err);
      }
    });
    ws.once("unexpected-response", (_req, response) => {
      clearTimeout(timer);
      ws.terminate();
      reject(new Error(`WebSocket upgrade rejected with HTTP ${response.statusCode}`));
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      ws.terminate();
      reject(err);
    });
    ws.once("message", (data) => {
      clearTimeout(timer);
      ws.close();
      resolve(JSON.parse(data.toString()));
    });
  });
}

try {
  const tokenResponse = await fetch(
    `${JWKS_TEST_URL}/sign?roles=field_agent&sub=${userId}&tenant_id=${tenantId}&region=${region}`,
  );
  token = (await tokenResponse.json()).token;
  assert.ok(token);

  await run("health and dependency readiness", async () => {
    const health = await request("/health", {}, false);
    const ready = await request("/health/ready", {}, false);
    assert.equal(health.response.status, 200);
    assert.equal(ready.response.status, 200);
    assert.equal(ready.body.checks.mongo, "ok");
    assert.equal(ready.body.checks.redis, "ok");
  });

  await run("private route rejects missing JWT", async () => {
    const result = await request("/sync/checkpoint", {}, false);
    assert.equal(result.response.status, 401);
  });

  await run("authenticated client schema negotiation", async () => {
    const result = await request("/sync/schema?version=1");
    assert.equal(result.response.status, 200);
    assert.equal(result.body.version, 1);
    assert.ok(result.body.ddl.length > 0);
  });

  const farmId = `farm-${runId}`;
  const clientSeq = Date.now();

  await run("push -> gRPC -> Postgres -> Debezium -> Kafka -> oplog -> pull", async () => {
    const push = await request("/sync/push", {
      method: "POST",
      body: JSON.stringify({
        clientId,
        writes: [
          {
            collection: "farms",
            docId: farmId,
            operation: "PUT",
            payload: {
              name: `E2E Farm ${runId}`,
              region,
              created_by: userId,
              tenant_id: "client-must-not-control-this",
            },
            clientTimestamp: new Date().toISOString(),
            baseSeq: 0,
            clientSeq,
            idempotencyKey: randomUUID(),
          },
        ],
      }),
    });
    assert.equal(push.response.status, 200);
    assert.equal(push.body.results[0].status, "applied");

    pushedFarmEntry = await waitForPull("farms", farmId);
    assert.equal(pushedFarmEntry.operation, "PUT");
    assert.equal(pushedFarmEntry.bucket, regionBucket);
    assert.equal(pushedFarmEntry.fullDoc.tenant_id, tenantId);
    assert.equal(pushedFarmEntry.fullDoc.client_id, clientId);
    assert.equal(Number(pushedFarmEntry.fullDoc.client_seq), clientSeq);
  });

  await run("oplog preserves client-origin metadata", async () => {
    const entry = await oplog.findOne({ collection: "farms", docId: farmId });
    assert.ok(entry);
    assert.equal(entry.origin, "client");
    assert.equal(entry.clientId, clientId);
    assert.equal(entry.clientSeq, clientSeq);
  });

  await run("pull exposes client-origin metadata", async () => {
    assert.equal(pushedFarmEntry.origin, "client");
    assert.equal(pushedFarmEntry.clientId, clientId);
    assert.equal(pushedFarmEntry.clientSeq, clientSeq);
  });

  await run("direct server write reaches user-scoped invoice bucket", async () => {
    const invoiceId = `invoice-${runId}`;
    await pg.query(
      `INSERT INTO invoices (id, tenant_id, user_id, amount, currency, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [invoiceId, tenantId, userId, 125.5, "USD", "open"],
    );
    const entry = await waitForPull("invoices", invoiceId);
    assert.equal(entry.bucket, userBucket);
    assert.equal(entry.fullDoc.user_id, userId);
  });

  await run("regional snapshot streams Postgres rows and snapshot checkpoint", async () => {
    const result = await request(
      `/sync/snapshot?bucket=${encodeURIComponent(regionBucket)}&collections=farms`,
    );
    assert.equal(result.response.status, 200);
    const lines = result.text.trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(lines.some((line) => line.collection === "farms" && line.doc.id === farmId));
    assert.ok(lines.some((line) => line._meta?.snapshotSeq >= 0));
  });

  await run("attachment snapshot filters by uploaded_by user bucket", async () => {
    const attachmentId = `attachment-${runId}`;
    await pg.query(
      `INSERT INTO attachments
       (id, tenant_id, parent_type, parent_id, uploaded_by, content_type, size_bytes, storage_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        attachmentId,
        tenantId,
        "farm",
        farmId,
        userId,
        "text/plain",
        12,
        `e2e/${attachmentId}`,
      ],
    );
    const result = await request(
      `/sync/snapshot?bucket=${encodeURIComponent(userBucket)}&collections=attachments`,
    );
    assert.equal(result.response.status, 200);
    const lines = result.text.trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(
      lines.some((line) => line.collection === "attachments" && line.doc.id === attachmentId),
    );
  });

  await run("attachment gRPC endpoints", async () => {
    const presign = await request("/sync/attachments/presign", {
      method: "POST",
      body: JSON.stringify({
        parentType: "farm",
        parentId: farmId,
        contentType: "text/plain",
        sizeBytes: 12,
      }),
    });
    assert.equal(presign.response.status, 200);
    assert.ok(presign.body.attachmentId);

    const download = await request(`/sync/attachments/${presign.body.attachmentId}/url`);
    assert.equal(download.response.status, 200);
    assert.ok(download.body.url);
  });

  await run("subscribe WebSocket accepts query-token authentication", async () => {
    const frame = await openWebSocket(`/sync/subscribe?token=${encodeURIComponent(token)}&seq=0`);
    assert.equal(frame.type, "checkpoint");
  });

  await run("stream WebSocket backfills data with query-token authentication", async () => {
    const frame = await openWebSocket(`/sync/stream?token=${encodeURIComponent(token)}`, (ws) => {
      ws.send(
        JSON.stringify({
          type: "start",
          buckets: [regionBucket, userBucket],
          checkpoints: { [regionBucket]: 0, [userBucket]: 0 },
          collections: ["farms"],
        }),
      );
    });
    assert.equal(frame.type, "data");
    assert.ok(frame.entries.some((entry) => entry.docId === farmId));
  });

  await run("Prometheus metrics endpoint", async () => {
    const result = await request("/metrics", {}, false);
    assert.equal(result.response.status, 200);
    assert.match(result.text, /sync_cdc_consumer_lag_total/);
  });
} finally {
  await pg.end();
  await mongo.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} end-to-end checks passed`);
if (failed.length > 0) {
  console.error("Failed checks:");
  for (const failure of failed) console.error(`- ${failure.name}: ${failure.error.message}`);
  process.exitCode = 1;
}
