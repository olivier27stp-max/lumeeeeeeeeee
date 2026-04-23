/**
 * In-memory TTL cache for hot read endpoints.
 *
 * Scope: single Node process. If you run multiple workers, each has its own
 * cache — that's fine for read-heavy endpoints where brief divergence is OK.
 * For cross-process invalidation, swap to Upstash Redis (same interface).
 */

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

// Soft cap to avoid unbounded growth on pathological key sets.
const MAX_ENTRIES = 5000;

function now(): number {
  return Date.now();
}

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key) as Entry<T> | undefined;
  if (!entry) return undefined;
  if (entry.expiresAt <= now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function cacheSet<T>(key: string, value: T, ttlSeconds: number): void {
  if (store.size >= MAX_ENTRIES) {
    // Evict the oldest ~10% to stay under cap
    const toEvict = Math.ceil(MAX_ENTRIES / 10);
    const iter = store.keys();
    for (let i = 0; i < toEvict; i++) {
      const k = iter.next().value;
      if (!k) break;
      store.delete(k);
    }
  }
  store.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
}

export function cacheDelete(key: string): void {
  store.delete(key);
}

/** Invalidate every key matching the prefix (e.g. `leaderboard:${orgId}:`). */
export function cacheDeletePrefix(prefix: string): void {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

/**
 * Fetch-or-compute. If the key is cached and fresh, returns it.
 * Otherwise runs `loader`, caches the result, and returns it.
 * Concurrent calls for the same key share the in-flight promise.
 */
const inFlight = new Map<string, Promise<unknown>>();

export async function cached<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;

  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const p = (async () => {
    try {
      const value = await loader();
      cacheSet(key, value, ttlSeconds);
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, p);
  return p;
}

// Periodically sweep expired entries so long-lived processes don't drift.
setInterval(() => {
  const t = now();
  for (const [k, entry] of store) {
    if (entry.expiresAt <= t) store.delete(k);
  }
}, 60_000).unref?.();
