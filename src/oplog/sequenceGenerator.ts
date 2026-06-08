export interface SequenceGenerator {
  nextSeq(): Promise<number>;
}

/**
 * Sequence numbers are logical sync checkpoints.
 *
 * Every oplog entry gets exactly one monotonic seq. Clients use that number as
 * "I have applied everything up to here", which is why this must be atomic and
 * cannot be derived from timestamps.
 *
 * Local-dev only. Production sequence ownership stays with RBAC/Postgres.
 * No sequence is derived from timestamps.
 */
export class RedisSequenceGenerator implements SequenceGenerator {
  constructor(private readonly redis: { incr(key: string): Promise<number> }) {}

  nextSeq(): Promise<number> {
    return this.redis.incr("sync:seq");
  }
}

/**
 * Future production boundary. Monotonic `seq` comes from a Postgres SEQUENCE
 * via RBAC (gRPC `getNextSeq()`). Unimplemented until the RBAC contract lands.
 */
export class PostgresSequenceGenerator implements SequenceGenerator {
  async nextSeq(): Promise<number> {
    throw new Error(
      "PostgresSequenceGenerator is not implemented until RBAC sequence contract is available",
    );
  }
}
