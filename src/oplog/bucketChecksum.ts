/*
 * PowerSync-style per-bucket checksum.
 *
 * The checksum lets a client and server cheaply compare "do we agree on bucket
 * contents up to seq X?" without replaying every entry. A mismatch tells the
 * client it should repair/re-snapshot that bucket.
 */
import type { OplogEntry } from "./oplogSchema.js";

const MOD32 = 0x1_0000_0000;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function hashEntry(entry: Pick<
  OplogEntry,
  "seq" | "collection" | "docId" | "operation" | "delta" | "fullDoc"
>): number {
  const canonical = canonicalJson({
    seq: entry.seq,
    collection: entry.collection,
    docId: entry.docId,
    operation: entry.operation,
    delta: entry.delta ?? null,
    fullDoc: entry.fullDoc ?? null,
  });
  let hash = FNV_OFFSET;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalJson((value as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

export interface ChecksumStore {
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<unknown>;
  eval?(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

const UPDATE_SCRIPT = `
local cur_seq = tonumber(redis.call('HGET', KEYS[1], 'seq')) or 0
local cur_csum = tonumber(redis.call('HGET', KEYS[1], 'csum')) or 0
local new_seq = tonumber(ARGV[1])
local h = tonumber(ARGV[2])
if new_seq > cur_seq then
  local new_csum = (cur_csum + h) % 4294967296
  redis.call('HSET', KEYS[1], 'seq', new_seq, 'csum', new_csum)
  return {new_seq, new_csum}
end
return {cur_seq, cur_csum}
`;

export interface BucketChecksumState {
  seq: number;
  csum: number;
}

export class BucketChecksum {
  constructor(private readonly store: ChecksumStore) {}

  private key(bucket: string): string {
    return `sync:checksum:${bucket}`;
  }

  async update(bucket: string, entry: OplogEntry): Promise<BucketChecksumState> {
    const h = hashEntry(entry);
    const key = this.key(bucket);
    if (this.store.eval) {
      try {
        const res = (await this.store.eval(UPDATE_SCRIPT, 1, key, String(entry.seq), String(h))) as
          | [number, number]
          | [string, string];
        return { seq: Number(res[0]), csum: Number(res[1]) };
      } catch {
        // fall through
      }
    }
    const curSeqStr = await this.store.hget(key, "seq");
    const curCsumStr = await this.store.hget(key, "csum");
    const curSeq = curSeqStr ? Number(curSeqStr) : 0;
    const curCsum = curCsumStr ? Number(curCsumStr) : 0;
    if (entry.seq <= curSeq) return { seq: curSeq, csum: curCsum };
    const newCsum = (curCsum + h) % MOD32;
    await this.store.hset(key, "seq", String(entry.seq));
    await this.store.hset(key, "csum", String(newCsum));
    return { seq: entry.seq, csum: newCsum };
  }

  async get(bucket: string): Promise<BucketChecksumState | null> {
    const key = this.key(bucket);
    const seqStr = await this.store.hget(key, "seq");
    const csumStr = await this.store.hget(key, "csum");
    if (seqStr == null && csumStr == null) return null;
    return { seq: Number(seqStr ?? 0), csum: Number(csumStr ?? 0) };
  }
}
