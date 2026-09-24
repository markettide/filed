/**
 * Small, process-local cache for shared market data.
 *
 * Authentication is deliberately kept outside this cache. API routes still
 * verify the member first, then these readers reuse the same public market
 * snapshot for a short time. A global store survives Next.js module reloads
 * and deduplicates simultaneous cache misses in the same server instance.
 */

const STORE_KEY = Symbol.for("market-tide.server-cache");
const MAX_ENTRIES = 32;

function store() {
  if (!globalThis[STORE_KEY]) globalThis[STORE_KEY] = new Map();
  return globalThis[STORE_KEY];
}

function prune(cache, now) {
  for (const [key, entry] of cache) {
    if (!entry.promise && entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

export async function withServerCache(key, ttlMs, loader, { cacheNull = true } = {}) {
  const cache = store();
  const now = Date.now();
  const existing = cache.get(key);

  if (existing?.promise) return existing.promise;
  if (existing && existing.expiresAt > now) return existing.value;

  const promise = Promise.resolve().then(loader);
  cache.set(key, { promise, expiresAt: now + ttlMs });

  try {
    const value = await promise;
    if (value == null && !cacheNull) cache.delete(key);
    else cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    prune(cache, Date.now());
    return value;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

export function clearServerCache() {
  store().clear();
}
