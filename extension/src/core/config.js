/**
 * @module config
 * Central configuration with sensible defaults and chrome.storage.sync overrides.
 * Every tunable parameter lives here so no other module hardcodes values.
 */

const DEFAULTS = Object.freeze({
  LOCAL_BASE_URL: 'http://localhost:11434',
  CLOUD_BASE_URL: 'http://localhost:3000',
  CLOUD_API_KEY: 'test_token',
  GEMMA_MODEL_TAG: 'gemma4:e2b',
  MAX_CONTEXT_CHARS: 6000,
  HEAD_RATIO: 0.5,
  MIDDLE_RATIO: 0.2,
  TAIL_RATIO: 0.3,
  HEALTH_TIMEOUT_MS: 5000,
  CLOUD_CONNECT_TIMEOUT_MS: 20000,
  CLOUD_TOTAL_TIMEOUT_MS: 60000,
  CLOUD_MAX_RETRIES: 2,
  CACHE_TTL_MS: 24 * 60 * 60 * 1000,
  CACHE_MAX_ENTRIES: 50,
  NUM_CTX: 4096,
  ON_DEMAND_INJECTION: false,
  AUTO_CLOUD_FALLBACK: true,
  EXTENSION_VERSION: '1.0.0',
  TYPEWRITER_SPEED_MS: 16
});

let _cachedOverrides = null;

/**
 * Load the merged config (DEFAULTS + user overrides from chrome.storage.sync).
 * The first call fetches from storage; subsequent calls return a cached copy.
 * Call invalidateConfigCache() after external writes to force a re-read.
 */
export async function loadConfig() {
  if (_cachedOverrides !== null) {
    return { ...DEFAULTS, ..._cachedOverrides };
  }
  try {
    const result = await chrome.storage.sync.get('config');
    _cachedOverrides = result.config || {};
  } catch {
    _cachedOverrides = {};
  }
  return { ...DEFAULTS, ..._cachedOverrides };
}

/**
 * Persist a partial config update to chrome.storage.sync and refresh the cache.
 */
export async function saveConfig(partial) {
  await loadConfig();
  const updated = { ..._cachedOverrides, ...partial };
  _cachedOverrides = updated;
  await chrome.storage.sync.set({ config: updated });
  return { ...DEFAULTS, ...updated };
}

/**
 * Force the next loadConfig() to re-read from storage.
 */
export function invalidateConfigCache() {
  _cachedOverrides = null;
}

export { DEFAULTS };
