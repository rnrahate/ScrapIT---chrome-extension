/**
 * @module health
 * Local Ollama runtime health-check.
 *
 * States returned:
 *   "ready"                  – runtime is up AND the configured model is present
 *   "runtime-up-model-missing" – runtime responds but model not in list
 *   "runtime-down"           – runtime unreachable within timeout
 */

import { loadConfig } from './config.js';

/**
 * @returns {Promise<{ status: string, models: string[], modelTag: string }>}
 */
export async function checkHealth() {
  const config = await loadConfig();
  const modelTag = config.GEMMA_MODEL_TAG;
  const timeoutMs = config.HEALTH_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${config.LOCAL_BASE_URL}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { status: 'runtime-down', models: [], modelTag };
    }

    const json = await res.json();
    const models = (json.models || []).map((m) => m.name || m.model || '');

    /* Ollama may return "gemma3:4b" or "gemma3:4b-latest" — we match the
       configured tag as a prefix so "gemma3:4b" matches "gemma3:4b-q4_0" etc. */
    const found = models.some(
      (name) => name === modelTag || name.startsWith(modelTag + '-') || name.startsWith(modelTag + ':')
    );

    return {
      status: found ? 'ready' : 'runtime-up-model-missing',
      models,
      modelTag,
    };
  } catch {
    clearTimeout(timer);
    return { status: 'runtime-down', models: [], modelTag };
  }
}
