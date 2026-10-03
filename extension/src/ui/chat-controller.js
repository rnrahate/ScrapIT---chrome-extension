/**
 * @module chat-controller
 * Shared chat session logic used by BOTH popup.js and the in-page drawer
 * (content.js).  Owns the port to the service worker for streaming and
 * a requestAnimationFrame-driven typewriter queue for smooth rendering.
 *
 * This module contains NO routing or network logic — it delegates all
 * I/O to the service worker via the long-lived port.
 */

import { el, text, clearChildren } from './dom.js';

/**
 * Error taxonomy → user-friendly messages with suggested actions.
 */
const ERROR_MESSAGES = {
  NETWORK_TIMEOUT: { text: 'Connection timed out. Check your network and try again.', action: 'Retry' },
  RUNTIME_DOWN: { text: 'Ollama is not running.', action: 'Download Ollama' },
  MODEL_MISSING: { text: 'Required model not found.', action: 'Pull Model' },
  CLOUD_AUTH: { text: 'Cloud authentication failed. Check your API key.', action: 'Settings' },
  RATE_LIMITED: { text: 'Too many requests. Please wait and try again.', action: 'Retry' },
  BAD_RESPONSE: { text: 'Received an invalid response.', action: 'Retry' },
  ABORTED: { text: 'Request cancelled.', action: null },
  DISCONNECTED: { text: 'Connection to the extension was lost.', action: 'Retry' },
};

/**
 * Create a ChatSession that manages communication with the service worker.
 *
 * @param {Object} callbacks
 * @param {Function} callbacks.onDelta        (text: string) → void
 * @param {Function} callbacks.onWidget       (widgetEvent: object) → void
 * @param {Function} callbacks.onDone         (fullText: string, usage: object) → void
 * @param {Function} callbacks.onError        (error: { code, message, action? }) → void
 * @param {Function} callbacks.onStatusChange (status: object) → void
 * @returns {ChatSession}
 */
export function createChatSession(callbacks) {
  let port = null;
  let connected = false;
  const messages = [];

  /* ── Typewriter queue ─────────────────────────────────────── */
  let typewriterQueue = [];
  let typewriterActive = false;
  let typewriterRafId = null;

  function enqueueText(txt) {
    for (const ch of txt) {
      typewriterQueue.push(ch);
    }
    if (!typewriterActive) drainTypewriter();
  }

  function drainTypewriter() {
    typewriterActive = true;
    typewriterRafId = requestAnimationFrame(() => {
      /* Drain up to 4 characters per frame for ~240 chars/sec at 60 fps */
      const batch = typewriterQueue.splice(0, 4).join('');
      if (batch) callbacks.onDelta(batch);

      if (typewriterQueue.length > 0) {
        drainTypewriter();
      } else {
        typewriterActive = false;
      }
    });
  }

  function flushTypewriter() {
    if (typewriterRafId) cancelAnimationFrame(typewriterRafId);
    const remaining = typewriterQueue.splice(0).join('');
    if (remaining) callbacks.onDelta(remaining);
    typewriterActive = false;
  }

  /* ── Port management ──────────────────────────────────────── */

  function ensurePort() {
    if (port && connected) return;
    port = chrome.runtime.connect({ name: 'chat-stream' });
    connected = true;

    port.onMessage.addListener((msg) => {
      switch (msg.type) {
        case 'delta':
          enqueueText(msg.text);
          break;

        case 'widget':
          flushTypewriter();
          callbacks.onWidget(msg);
          break;

        case 'done':
          flushTypewriter();
          messages.push({ role: 'assistant', content: msg.fullText || '' });
          callbacks.onDone(msg.fullText || '', msg.usage || {});
          break;

        case 'error': {
          flushTypewriter();
          const mapped = ERROR_MESSAGES[msg.code] || { text: msg.message, action: 'Retry' };
          callbacks.onError({
            code: msg.code,
            message: msg.message || mapped.text,
            friendlyMessage: mapped.text,
            action: mapped.action,
          });
          break;
        }

        case 'status':
          callbacks.onStatusChange(msg);
          break;

        case 'heartbeat':
          /* keep-alive — nothing to do */
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      connected = false;
      port = null;
      if (typewriterQueue.length > 0) {
        flushTypewriter();
      }
    });
  }

  /* ── Public API ───────────────────────────────────────────── */

  return {
    /**
     * Send a user message (triggers streaming from the worker).
     * @param {string} userText
     * @param {object} pageContext
     */
    send(userText, pageContext) {
      ensurePort();
      messages.push({ role: 'user', content: userText });

      port.postMessage({
        type: 'start',
        messages: [...messages],
        pageContext,
      });
    },

    /** Cancel the active stream. */
    stop() {
      flushTypewriter();
      if (port && connected) {
        port.postMessage({ type: 'stop' });
      }
    },

    /** Cleanly disconnect and release resources. */
    destroy() {
      flushTypewriter();
      if (port) {
        try { port.disconnect(); } catch { /* noop */ }
        port = null;
        connected = false;
      }
    },

    /** Return a copy of the conversation history. */
    getMessages() {
      return [...messages];
    },

    /** Clear conversation history. */
    clearHistory() {
      messages.length = 0;
    },
  };
}
