export interface SequenceGenerator {
  nextSeq(): Promise<number>;
}

/**
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
