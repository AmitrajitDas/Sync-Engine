import "dotenv/config";
import { parseEnv } from "./config/env.js";
import { buildApp } from "./app.js";
import { MongoClient } from "mongodb";
import { Redis } from "ioredis";
import { Kafka } from "kafkajs";
import { Pool } from "pg";
import { OPLOG_COLLECTION, type OplogEntry } from "./oplog/oplogSchema.js";
import { ensureOplogIndexes } from "./oplog/oplogIndexes.js";
import { OplogService } from "./oplog/oplogService.js";
import { RedisSequenceGenerator } from "./oplog/sequenceGenerator.js";
import { InProcessEventBus } from "./eventbus/InProcessEventBus.js";
import { OplogConsumer } from "./eventbus/consumers/OplogConsumer.js";
import { SubscriptionNotifier } from "./eventbus/consumers/SubscriptionNotifier.js";
import { DebeziumKafkaConsumer } from "./cdc/DebeziumKafkaConsumer.js";
import { ConflictResolver } from "./conflicts/conflictResolver.js";
import { RbacCheckClient } from "./grpc/RbacCheckClient.js";
import { BusinessProxyClient } from "./grpc/BusinessProxyClient.js";
import { AttachmentClient } from "./grpc/AttachmentClient.js";
import { registerGracefulShutdown } from "./lifecycle/gracefulShutdown.js";
import { PostgresSnapshotReader } from "./snapshot/postgresSnapshotReader.js";
import { SubscriptionRegistry } from "./realtime/subscriptionRegistry.js";
import { RedisFanout } from "./realtime/redisFanout.js";
import { BucketChecksum } from "./oplog/bucketChecksum.js";
import { setupTracing } from "./observability/tracing.js";

const env = parseEnv();

setupTracing({ serviceName: "sync-engine", exporterEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT });

// Infrastructure connections
const mongoClient = new MongoClient(env.MONGODB_URI);
await mongoClient.connect();
const db = mongoClient.db();

const redis = new Redis(env.REDIS_URL);

const seqGen = new RedisSequenceGenerator(redis);
const oplogCollection = db.collection<OplogEntry>(OPLOG_COLLECTION);

// Ensure indexes before accepting traffic (idempotent)
await ensureOplogIndexes(oplogCollection, env.OPLOG_TTL_DAYS);

const oplogService = new OplogService(oplogCollection, seqGen, {
  defaultLimit: env.PULL_DEFAULT_LIMIT,
  maxLimit: env.PULL_MAX_LIMIT,
});

// Realtime subscriptions
const subscriptionRegistry = new SubscriptionRegistry();
const redisPub = new Redis(env.REDIS_URL);
const redisSub = new Redis(env.REDIS_URL);
const redisFanout = new RedisFanout(redisPub, redisSub, subscriptionRegistry, oplogService);
await redisFanout.start();

// Bucket checksum store (SPEC-032)
const bucketChecksum = new BucketChecksum(redis);

// EventBus + consumers
const eventBus = new InProcessEventBus();
const oplogConsumer = new OplogConsumer(oplogService, redis, bucketChecksum);
const subscriptionNotifier = new SubscriptionNotifier(subscriptionRegistry, redisFanout);
eventBus.register(oplogConsumer);
eventBus.register(subscriptionNotifier);

// CDC consumer
const kafka = new Kafka({
  clientId: "sync-engine",
  brokers: env.KAFKA_BROKERS.split(","),
});
const cdcConsumer = new DebeziumKafkaConsumer(
  kafka,
  eventBus,
  {
    groupId: env.KAFKA_CONSUMER_GROUP,
    topicPrefix: env.KAFKA_CDC_TOPIC_PREFIX,
  },
  undefined,
);

// gRPC clients
const rbacCheck = new RbacCheckClient({
  address: env.RBAC_GRPC_ADDRESS,
  timeoutMs: env.RBAC_GRPC_TIMEOUT_MS,
});
const businessProxy = new BusinessProxyClient({
  address: env.RBAC_GRPC_ADDRESS,
  timeoutMs: env.RBAC_GRPC_TIMEOUT_MS,
});
const attachmentClient = new AttachmentClient({
  address: env.RBAC_GRPC_ADDRESS,
  timeoutMs: env.RBAC_GRPC_TIMEOUT_MS,
});
const conflictResolver = new ConflictResolver(oplogService);

// Optional Postgres snapshot reader
const snapshotReader = env.PG_READ_REPLICA_URL
  ? new PostgresSnapshotReader(new Pool({ connectionString: env.PG_READ_REPLICA_URL }))
  : undefined;

const app = await buildApp(env, {
  mongo: db,
  mongoClient,
  redis,
  oplogService,
  rbacCheck,
  businessProxy,
  attachmentClient,
  conflictResolver,
  snapshotReader,
  subscriptionRegistry,
  bucketChecksum,
  schemaEnv: {
    rolloutPercent: env.SCHEMA_ROLLOUT_PERCENT,
    minSupportedVersion: env.SCHEMA_MIN_SUPPORTED_VERSION,
    killSwitch: env.SCHEMA_KILL_SWITCH,
  },
});

registerGracefulShutdown({
  app,
  redis,
  mongoClient,
  kafkaConsumer: cdcConsumer,
  grpcInflight: () => businessProxy.inflightCount,
});

try {
  await cdcConsumer.start();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
