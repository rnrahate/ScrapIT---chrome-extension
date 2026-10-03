/**
 * @module cache
 * chrome.storage.local summary cache with TTL and LRU-style eviction.
 *
 * Key format: "summary:<normalizedUrl>"
 * Value: { summary, createdAt, contentHash, model, route }
 * TTL:   24 hours (configurable)
 * Cap:   50 entries (oldest evicted first)
 */

const CACHE_PREFIX = 'summary:';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 50;

/**
 * Normalise a URL for cache-keying.
 * Strips: hash fragment, utm_* and common tracking query params.
 */
export function normaliseUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';

    const toDelete = [];
    for (const key of u.searchParams.keys()) {
      if (/^utm_/i.test(key) || /^(fbclid|gclid|ref|source|mc_)$/i.test(key)) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) u.searchParams.delete(key);

    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * Get a cached summary.
 * @returns {{ hit: boolean, data?: object }}
 */
export async function getCache(url, ttlMs = DEFAULT_TTL_MS) {
  const key = CACHE_PREFIX + normaliseUrl(url);

  try {
    const result = await chrome.storage.local.get(key);
    const entry = result[key];

    if (!entry) return { hit: false };

    if (Date.now() - entry.createdAt > ttlMs) {
      await chrome.storage.local.remove(key);
      return { hit: false };
    }

    return { hit: true, data: entry };
  } catch {
    return { hit: false };
  }
}

/**
 * Store a summary in the cache, evicting the oldest entry when over cap.
 */
export async function setCache(url, data, maxEntries = DEFAULT_MAX_ENTRIES) {
  const key = CACHE_PREFIX + normaliseUrl(url);
  const entry = { ...data, createdAt: Date.now() };

  try {
    await chrome.storage.local.set({ [key]: entry });
    await evictIfNeeded(maxEntries);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Delete the cache entry for a URL.
 */
export async function clearCache(url) {
  const key = CACHE_PREFIX + normaliseUrl(url);
  await chrome.storage.local.remove(key);
}

/**
 * Evict the oldest entries so total cached summaries ≤ maxEntries.
 */
async function evictIfNeeded(maxEntries) {
  const all = await chrome.storage.local.get(null);
  const cacheKeys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));

  if (cacheKeys.length <= maxEntries) return;

  /* Sort by createdAt ascending → oldest first */
  const sorted = cacheKeys
    .map((k) => ({ key: k, createdAt: all[k].createdAt || 0 }))
    .sort((a, b) => a.createdAt - b.createdAt);

  const toEvict = sorted.slice(0, sorted.length - maxEntries).map((e) => e.key);
  if (toEvict.length > 0) {
    await chrome.storage.local.remove(toEvict);
  }
}
