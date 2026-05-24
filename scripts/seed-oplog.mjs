/**
 * Seed test oplog entries into MongoDB for manual testing.
 * Usage: node scripts/seed-oplog.mjs
 */

import { MongoClient, ObjectId } from "mongodb";

const URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017/sync";
const client = new MongoClient(URI);

await client.connect();
const db = client.db();
const col = db.collection("oplog");

// Clear existing test entries
await col.deleteMany({ cdcEventId: { $regex: /^manual-test:/ } });

const now = new Date();
const entries = [
  {
    _id: new ObjectId(),
    seq: 1,
    timestamp: now,
    collection: "farms",
    docId: "farm-001",
    operation: "PUT",
    delta: { name: "Farm Alpha", region: "west", tenant_id: "tenant-abc" },
    fullDoc: { id: "farm-001", name: "Farm Alpha", region: "west", tenant_id: "tenant-abc" },
    bucket: "tenant:tenant-abc:region:west",
    tenantId: "tenant-abc",
    origin: "server",
    cdcEventId: "manual-test:0",
  },
  {
    _id: new ObjectId(),
    seq: 2,
    timestamp: now,
    collection: "farms",
    docId: "farm-002",
    operation: "PUT",
    delta: { name: "Farm Beta", region: "west", tenant_id: "tenant-abc" },
    fullDoc: { id: "farm-002", name: "Farm Beta", region: "west", tenant_id: "tenant-abc" },
    bucket: "tenant:tenant-abc:region:west",
    tenantId: "tenant-abc",
    origin: "server",
    cdcEventId: "manual-test:1",
  },
  {
    _id: new ObjectId(),
    seq: 3,
    timestamp: now,
    collection: "invoices",
    docId: "inv-001",
    operation: "PUT",
    delta: { amount: 100, user_id: "user-001", tenant_id: "tenant-abc" },
    fullDoc: { id: "inv-001", amount: 100, user_id: "user-001", tenant_id: "tenant-abc" },
    bucket: "tenant:tenant-abc:user:user-001",
    tenantId: "tenant-abc",
    origin: "server",
    cdcEventId: "manual-test:2",
  },
  {
    _id: new ObjectId(),
    seq: 4,
    timestamp: now,
    collection: "farms",
    docId: "farm-001",
    operation: "PATCH",
    delta: { name: "Farm Alpha Updated" },
    fullDoc: { id: "farm-001", name: "Farm Alpha Updated", region: "west", tenant_id: "tenant-abc" },
    bucket: "tenant:tenant-abc:region:west",
    tenantId: "tenant-abc",
    origin: "server",
    cdcEventId: "manual-test:3",
  },
  {
    _id: new ObjectId(),
    seq: 5,
    timestamp: now,
    collection: "farms",
    docId: "farm-002",
    operation: "REMOVE",
    delta: null,
    bucket: "tenant:tenant-abc:region:west",
    tenantId: "tenant-abc",
    origin: "server",
    cdcEventId: "manual-test:4",
  },
];

try {
  const result = await col.insertMany(entries, { ordered: false });
  console.log(`Seeded ${result.insertedCount} oplog entries`);
} catch (err) {
  if (err.code === 11000) {
    console.log("Some entries already exist (idempotent), continuing");
  } else {
    throw err;
  }
}

const count = await col.countDocuments();
console.log(`Total oplog entries: ${count}`);

// Also seed Redis checkpoint cache
console.log("\nOplog seeded. Run tests now.");
await client.close();
