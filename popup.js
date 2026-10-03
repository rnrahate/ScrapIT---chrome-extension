/**
 * popup.js — ES module entry point for the extension popup.
 *
 * Uses the shared chat-controller for streaming and delegates all
 * network I/O to the service worker.  The popup never calls fetch
 * to localhost or the cloud directly.
 *
 * On init it performs a health check, then shows the appropriate panel:
 *   • "ready"                   → main chat UI
 *   • "runtime-up-model-missing" → pull instructions
 *   • "runtime-down"            → download link or cloud fallback
 *
 * Security: all DOM built via safe helpers — no innerHTML.
 */

import { el, safeLink, clearChildren } from './src/ui/dom.js';
import { renderWidget } from './src/ui/widgets.js';
import { createChatSession } from './src/ui/chat-controller.js';

/* ── DOM references ─────────────────────────────────────────── */
const popupStatus = document.getElementById('popup-status');
const panelRuntimeDown = document.getElementById('panel-runtime-down');
const panelModelMissing = document.getElementById('panel-model-missing');
const panelMain = document.getElementById('panel-main');
const quickActions = document.getElementById('quick-actions');
const outputViewport = document.getElementById('output-viewport');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const stopBtn = document.getElementById('stop-btn');

/* ── State ──────────────────────────────────────────────────── */
let chatSession = null;
let streaming = false;
let assistantTextNode = null;
let currentHealth = null;

/* ── Init ───────────────────────────────────────────────────── */
init();

async function init() {
  setupQuickActions();
  setupInputHandlers();
  await runHealthCheck();

  /* Re-check on focus (user may have started Ollama while popup was open) */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') runHealthCheck();
  });
}

/* ── Health check ───────────────────────────────────────────── */
async function runHealthCheck() {
  setStatus('…', '');

  try {
    currentHealth = await chrome.runtime.sendMessage({ action: 'health-check' });
  } catch {
    currentHealth = { status: 'runtime-down', models: [], modelTag: 'gemma3:4b' };
  }

  panelRuntimeDown.hidden = true;
  panelModelMissing.hidden = true;
  panelMain.hidden = false;

  switch (currentHealth.status) {
    case 'ready':
      setStatus('Local Ready', 'ready');
      break;

    case 'runtime-up-model-missing':
      setStatus('Model Missing', 'missing');
      panelMain.hidden = true;
      panelModelMissing.hidden = false;
      buildModelMissingPanel(currentHealth.modelTag);
      break;

    case 'runtime-down':
      setStatus('Offline', 'error');
      panelMain.hidden = true;
      panelRuntimeDown.hidden = false;
      buildRuntimeDownPanel();
      break;
  }
}

function setStatus(label, cls) {
  popupStatus.textContent = label;
  popupStatus.className = 'status-chip ' + cls;
}

/* ── Panel builders ─────────────────────────────────────────── */
function buildRuntimeDownPanel() {
  clearChildren(panelRuntimeDown);
  panelRuntimeDown.appendChild(
    el('div', {}, [
      el('div', { className: 'panel-icon', textContent: '🔌' }),
      el('h3', { className: 'panel-title', textContent: 'Local Runtime Not Found' }),
      el('p', { className: 'panel-desc', textContent: 'Ollama is not running or not installed. The local Gemma model needs Ollama to run on your machine.' }),
      el('div', { className: 'panel-actions' }, [
        safeLink('https://ollama.com/download', '⬇ Download Ollama', { className: 'btn-primary' }),
        el('button', {
          className: 'btn-secondary',
          textContent: '☁ Use Cloud Instead',
          onClick: () => {
            panelRuntimeDown.hidden = true;
            panelMain.hidden = false;
            setStatus('🌐 Cloud', 'cloud');
          },
        }),
      ]),
    ])
  );
}

function buildModelMissingPanel(modelTag) {
  clearChildren(panelModelMissing);
  panelModelMissing.appendChild(
    el('div', {}, [
      el('div', { className: 'panel-icon', textContent: '📦' }),
      el('h3', { className: 'panel-title', textContent: 'Model Not Installed' }),
      el('p', { className: 'panel-desc' }, [
        'Ollama is running but the model ',
        el('strong', { textContent: modelTag }),
        ' was not found. Pull it with:',
      ]),
      el('code', { className: 'panel-code', textContent: `ollama pull ${modelTag}` }),
      el('div', { className: 'panel-actions' }, [
        el('button', {
          className: 'btn-primary',
          textContent: '🔄 Re-check',
          onClick: () => runHealthCheck(),
        }),
        el('button', {
          className: 'btn-secondary',
          textContent: '☁ Use Cloud Instead',
          onClick: () => {
            panelModelMissing.hidden = true;
            panelMain.hidden = false;
            setStatus('🌐 Cloud', 'cloud');
          },
        }),
      ]),
    ])
  );
}

/* ── Quick actions ──────────────────────────────────────────── */
function setupQuickActions() {
  const summarizeBtn = el('button', {
    className: 'quick-btn',
    textContent: '✨ Summarize',
    onClick: () => handleSend('Summarize this page'),
  });

  const keyPointsBtn = el('button', {
    className: 'quick-btn',
    textContent: '📋 Key Points',
    onClick: () => handleSend('List the key points of this page'),
  });

  quickActions.appendChild(summarizeBtn);
  quickActions.appendChild(keyPointsBtn);
}

/* ── Input handling ─────────────────────────────────────────── */
function setupInputHandlers() {
  sendBtn.addEventListener('click', () => handleSend());
  stopBtn.addEventListener('click', () => handleStop());

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
}

/* ── Send message ───────────────────────────────────────────── */
async function handleSend(overrideText) {
  const userText = overrideText || chatInput.value.trim();
  if (!userText || streaming) return;

  chatInput.value = '';

  /* Show user bubble */
  appendMessage('user', userText);

  /* Get page context from the content script */
  let pageContext = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      pageContext = await chrome.tabs.sendMessage(tab.id, { action: 'scrape' });
    }
  } catch {
    /* Content script may not be available (e.g., chrome:// pages) */
  }

  /* Show skeleton */
  const skeleton = createSkeleton();
  outputViewport.appendChild(skeleton);
  autoScroll();

  /* Prepare assistant bubble */
  const assistantBubble = el('div', { className: 'msg msg-assistant' });
  assistantTextNode = document.createTextNode('');
  assistantBubble.appendChild(assistantTextNode);

  streaming = true;
  setStreamingUI(true);

  ensureChatSession();

  let skeletonRemoved = false;
  const skeletonWatcher = setInterval(() => {
    if (assistantTextNode.textContent.length > 0 && !skeletonRemoved) {
      skeletonRemoved = true;
      if (skeleton.parentNode) skeleton.parentNode.removeChild(skeleton);
      outputViewport.appendChild(assistantBubble);
    }
    if (!streaming) {
      clearInterval(skeletonWatcher);
      if (!skeletonRemoved) {
        if (skeleton.parentNode) skeleton.parentNode.removeChild(skeleton);
        outputViewport.appendChild(assistantBubble);
      }
    }
  }, 50);

  chatSession.send(userText, pageContext);
}

function handleStop() {
  if (chatSession) chatSession.stop();
  streaming = false;
  setStreamingUI(false);
}

/* ── Chat session setup ─────────────────────────────────────── */
function ensureChatSession() {
  if (chatSession) return;

  chatSession = createChatSession({
    onDelta(txt) {
      if (!assistantTextNode) return;
      assistantTextNode.textContent += txt;
      autoScroll();
    },

    onWidget(widgetEvent) {
      const widgetEl = renderWidget(widgetEvent);
      outputViewport.appendChild(widgetEl);
      autoScroll();
    },

    onDone(_fullText, _usage) {
      streaming = false;
      assistantTextNode = null;
      setStreamingUI(false);
    },

    onError(err) {
      streaming = false;
      assistantTextNode = null;
      setStreamingUI(false);
      showError(err);
    },

    onStatusChange(status) {
      if (status.route === 'cloud') {
        setStatus('🌐 Cloud Syncing', 'cloud-sync');
      } else {
        setStatus('Local Ready', 'ready');
      }
    },
  });
}

/* ── UI helpers ─────────────────────────────────────────────── */
function appendMessage(role, text) {
  const bubble = el('div', {
    className: `msg msg-${role}`,
    textContent: text,
  });
  outputViewport.appendChild(bubble);
  autoScroll();
}

function createSkeleton() {
  return el('div', { className: 'skeleton', 'aria-label': 'Loading' }, [
    el('div', { className: 'skeleton-line' }),
    el('div', { className: 'skeleton-line' }),
    el('div', { className: 'skeleton-line' }),
  ]);
}

function setStreamingUI(isStreaming) {
  sendBtn.hidden = isStreaming;
  stopBtn.hidden = !isStreaming;
  chatInput.disabled = isStreaming;
}

function showError(err) {
  const banner = el('div', { className: 'error-banner' }, [
    el('span', { className: 'error-banner-text', textContent: err.friendlyMessage || err.message }),
    err.action
      ? el('button', {
          className: 'error-banner-btn',
          textContent: err.action,
          onClick: () => {
            if (banner.parentNode) banner.parentNode.removeChild(banner);
            if (err.action === 'Retry') handleSend();
            if (err.action === 'Download Ollama') {
              chrome.tabs.create({ url: 'https://ollama.com/download' });
            }
          },
        })
      : null,
  ].filter(Boolean));
  outputViewport.appendChild(banner);
  autoScroll();
}

function autoScroll() {
  const threshold = 40;
  const isAtBottom = outputViewport.scrollHeight - outputViewport.scrollTop - outputViewport.clientHeight < threshold;
  if (isAtBottom) {
    outputViewport.scrollTop = outputViewport.scrollHeight;
  }
}
