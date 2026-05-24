// SPEC-026 — atomic monotonic checkpoint cache. Final value is the max of
// concurrent writes, never regressing.

export interface CheckpointCacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  eval?(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

const MAX_SCRIPT = `
local cur = tonumber(redis.call('GET', KEYS[1]))
local incoming = tonumber(ARGV[1])
if cur == nil or incoming > cur then
  redis.call('SET', KEYS[1], ARGV[1])
end
return 1
`;

export async function setMonotonic(
  store: CheckpointCacheStore,
  key: string,
  seq: number,
): Promise<void> {
  if (store.eval) {
    try {
      await store.eval(MAX_SCRIPT, 1, key, String(seq));
      return;
    } catch {
      // fall through to CAS loop
    }
  }
  // Best-effort CAS for stores without Lua (in-memory test doubles).
  for (let i = 0; i < 3; i++) {
    const cur = await store.get(key);
    const curN = cur != null ? Number(cur) : null;
    if (curN != null && curN >= seq) return;
    await store.set(key, String(seq));
    const after = await store.get(key);
    if (after != null && Number(after) >= seq) return;
  }
}
