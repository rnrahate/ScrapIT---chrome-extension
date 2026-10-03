/**
 * @module stream-parsers
 *
 * Two streaming parsers exposing the same async-iterator interface:
 *   yield { type: "delta" | "widget" | "done" | "error", ... }
 *
 * • parseNDJSON — for Ollama (newline-delimited JSON)
 * • parseSSE    — for the cloud API (Server-Sent Events)
 *
 * Both accept a ReadableStreamDefaultReader from response.body.getReader()
 * and use TextDecoder({ stream: true }) to handle partial multi-byte chars.
 */

/* ────────────────────────────────────────────────────────────────
 * NDJSON PARSER  (Ollama /api/chat)
 * Each line is a complete JSON object.
 * The final object has "done": true and optional eval metadata.
 * ──────────────────────────────────────────────────────────────── */

/**
 * @param {ReadableStreamDefaultReader} reader
 * @yields {{ type: "delta"|"done"|"error", [key: string]: any }}
 */
export async function* parseNDJSON(reader) {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const event = parseNDJSONLine(trimmed);
        if (event) yield event;
      }
    }

    /* Flush remaining buffer */
    const remaining = (buffer + decoder.decode()).trim();
    if (remaining) {
      const event = parseNDJSONLine(remaining);
      if (event) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseNDJSONLine(line) {
  try {
    const data = JSON.parse(line);

    if (data.error) {
      return { type: 'error', code: 'BAD_RESPONSE', message: data.error };
    }
    if (data.done) {
      return {
        type: 'done',
        usage: {
          promptTokens: data.prompt_eval_count || 0,
          completionTokens: data.eval_count || 0,
          totalDuration: data.total_duration || 0,
        },
      };
    }
    if (data.message && data.message.content) {
      return { type: 'delta', text: data.message.content };
    }
    return null;
  } catch (e) {
    return { type: 'error', code: 'BAD_RESPONSE', message: 'Invalid JSON line: ' + e.message };
  }
}

/* ────────────────────────────────────────────────────────────────
 * SSE PARSER  (Cloud /v1/chat — text/event-stream)
 *
 * Format per the spec:
 *   event: delta\n
 *   data: {"text": "..."}\n\n
 *
 *   event: widget\n
 *   data: {"type":"widget_render","widget":"map","payload":{...},"fallback_text":"..."}\n\n
 *
 *   event: done\n
 *   data: {"usage":{...}}\n\n
 *
 *   event: error\n
 *   data: {"code":"...","message":"..."}\n\n
 *
 * Handles: multi-line data fields, SSE comments (lines starting with :),
 * and empty event names (default "message").
 * ──────────────────────────────────────────────────────────────── */

/**
 * @param {ReadableStreamDefaultReader} reader
 * @yields {{ type: "delta"|"widget"|"done"|"error", [key: string]: any }}
 */
export async function* parseSSE(reader) {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      /* Split on double-newline (SSE event boundary).
       * Keep the last segment which may be incomplete. */
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';

      for (const block of blocks) {
        const event = parseSSEBlock(block);
        if (event) yield event;
      }
    }

    /* Flush */
    const remaining = (buffer + decoder.decode()).trim();
    if (remaining) {
      const event = parseSSEBlock(remaining);
      if (event) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSSEBlock(raw) {
  let eventType = '';
  const dataLines = [];

  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) continue;                 // SSE comment
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5));
    } else if (line.startsWith('id:') || line.startsWith('retry:')) {
      /* ignored — we don't reconnect */
    }
  }

  if (dataLines.length === 0) return null;
  const dataStr = dataLines.join('\n').trim();
  if (!dataStr) return null;

  try {
    const data = JSON.parse(dataStr);

    switch (eventType) {
      case 'delta':
        return { type: 'delta', text: data.text || '' };

      case 'widget':
        return {
          type: 'widget',
          widgetType: data.widget,
          payload: data.payload,
          fallbackText: data.fallback_text || '',
        };

      case 'done':
        return { type: 'done', usage: data.usage || {} };

      case 'error':
        return {
          type: 'error',
          code: data.code || 'UNKNOWN',
          message: data.message || 'Unknown cloud error',
        };

      default:
        /* Unknown event type — treat text as delta for forward compat */
        if (data.text) return { type: 'delta', text: data.text };
        return null;
    }
  } catch {
    return { type: 'error', code: 'BAD_RESPONSE', message: 'Malformed SSE data payload' };
  }
}
