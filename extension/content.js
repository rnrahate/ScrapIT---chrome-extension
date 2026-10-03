/**
 * content.js — MV3 Content Script
 *
 * Injected at document_idle on all URLs (excluding chrome:// and Web Store).
 *
 * Responsibilities:
 *   1. Scrape page content on demand (via message from popup or user action).
 *   2. Render a floating action button (FAB) and a slide-in chat drawer
 *      inside a closed Shadow DOM so host-page CSS cannot interfere.
 *   3. Communicate with the service worker for ALL network I/O.
 *   4. Detect SPA navigation and invalidate stale page context.
 *
 * Security:
 *   - No innerHTML/outerHTML/insertAdjacentHTML/document.write.
 *   - All DOM built with createElement + textContent + setAttribute + appendChild.
 *   - Model output rendered exclusively with textContent.
 *   - Links validated via safeLink (URL protocol allow-list).
 *   - Shadow DOM mode: "closed" — reference kept in module-scope closure only.
 *
 * Dynamic imports resolve to chrome-extension:// URLs in the isolated world.
 * The imported files are listed in web_accessible_resources in manifest.json.
 */

/* ── Synchronous message listener (registered before async setup) ──── */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'scrape') {
    import(chrome.runtime.getURL('src/core/scraper.js'))
      .then(({ extractPageContent }) => {
        sendResponse(extractPageContent(document));
      })
      .catch(() => {
        sendResponse({ text: '', originalLength: 0, truncated: false, title: document.title, url: location.href, contentHash: '' });
      });
    return true;
  }
});

/* ── Main IIFE — builds the FAB, drawer, and chat UI ───────────────── */

(async () => {
  /* Guard: don't inject into iframes */
  if (window !== window.top) return;

  /* ── Dynamic imports ──────────────────────────────────────── */
  const { el, safeLink, clearChildren } = await import(chrome.runtime.getURL('src/ui/dom.js'));
  const { renderWidget } = await import(chrome.runtime.getURL('src/ui/widgets.js'));
  const { createChatSession } = await import(chrome.runtime.getURL('src/ui/chat-controller.js'));
  const { extractPageContent } = await import(chrome.runtime.getURL('src/core/scraper.js'));

  /* ── State ────────────────────────────────────────────────── */
  let drawerOpen = false;
  let streaming = false;
  let currentRoute = 'local';
  let cachedPageContext = null;
  let lastUrl = location.href;
  let chatSession = null;
  let assistantTextNode = null;

  /* ── Shadow DOM host ──────────────────────────────────────── */
  const host = document.createElement('gemma-web-companion');
  const shadow = host.attachShadow({ mode: 'closed' });

  /* Load CSS via fetch → adoptedStyleSheets to minimise fingerprinting.
     Falls back to fetching through the background worker if cross-origin
     restrictions apply. */
  let cssText = '';
  try {
    cssText = await (await fetch(chrome.runtime.getURL('src/ui/drawer.css'))).text();
  } catch {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'get-css', path: 'src/ui/drawer.css' });
      cssText = res.css || '';
    } catch { /* give up — drawer will be unstyled */ }
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(cssText);
  shadow.adoptedStyleSheets = [sheet];

  /* ── Build FAB ────────────────────────────────────────────── */
  const fabIcon = el('svg', {
    className: 'gwc-fab-icon',
    viewBox: '0 0 24 24',
    'aria-hidden': 'true',
  }, [createSVGPath('M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12zm-9-4h2v2h-2zm0-6h2v4h-2z')]);

  const fab = el('button', {
    className: 'gwc-fab',
    'aria-label': 'Open Gemma Web Companion',
    'aria-expanded': 'false',
    tabindex: '0',
    onClick: () => toggleDrawer(),
  }, [fabIcon]);

  /* ── Build Drawer ─────────────────────────────────────────── */
  const statusChip = el('span', { className: 'gwc-status-chip local', textContent: 'LOCAL' });

  const closeBtn = el('button', {
    className: 'gwc-close-btn',
    'aria-label': 'Close drawer',
    textContent: '✕',
    onClick: () => closeDrawer(),
  });

  const drawerHeader = el('div', { className: 'gwc-drawer-header' }, [
    el('h2', { className: 'gwc-drawer-title', textContent: 'Gemma Companion' }),
    statusChip,
    closeBtn,
  ]);

  const messageList = el('div', {
    className: 'gwc-messages',
    role: 'log',
    'aria-live': 'polite',
    'aria-label': 'Chat messages',
  });

  const quickSummarize = el('button', {
    className: 'gwc-quick-btn',
    textContent: '✨ Summarize this page',
    onClick: () => handleSend('Summarize this page'),
  });

  const quickActions = el('div', { className: 'gwc-quick-actions' }, [quickSummarize]);

  const textarea = el('textarea', {
    className: 'gwc-textarea',
    placeholder: 'Ask about this page…',
    rows: '1',
    'aria-label': 'Message input',
  });

  const sendBtn = el('button', {
    className: 'gwc-send-btn',
    textContent: 'Send',
    onClick: () => handleSend(),
  });

  const stopBtn = el('button', {
    className: 'gwc-stop-btn',
    textContent: 'Stop',
    style: { display: 'none' },
    onClick: () => handleStop(),
  });

  const inputBar = el('div', { className: 'gwc-input-bar' }, [textarea, sendBtn, stopBtn]);

  const drawer = el('div', { className: 'gwc-drawer' }, [
    drawerHeader,
    messageList,
    quickActions,
    inputBar,
  ]);

  /* No backdrop overlay — the drawer is a side-panel, not a modal.
     Users close it via the ✕ button or Escape key.  The page behind
     remains fully interactive while the drawer is open. */

  /* ── Keyboard: Enter to send, Shift+Enter newline ─────────── */
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  /* ── Auto-resize textarea ─────────────────────────────────── */
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
  });

  /* ── Escape closes ────────────────────────────────────────── */
  shadow.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerOpen) {
      e.stopPropagation();
      closeDrawer();
    }
  });

  /* ── Append to page ───────────────────────────────────────── */
  shadow.appendChild(drawer);
  shadow.appendChild(fab);
  document.documentElement.appendChild(host);

  /* ── Drawer open/close ────────────────────────────────────── */
  function toggleDrawer() {
    drawerOpen ? closeDrawer() : openDrawer();
  }

  function openDrawer() {
    drawerOpen = true;
    drawer.classList.add('open');
    fab.setAttribute('aria-expanded', 'true');
    fab.style.display = 'none';
    textarea.focus();
  }

  function closeDrawer() {
    drawerOpen = false;
    drawer.classList.remove('open');
    fab.setAttribute('aria-expanded', 'false');
    fab.style.display = '';
    fab.focus();
  }

  /* ── Chat session setup ───────────────────────────────────── */
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
        messageList.appendChild(widgetEl);
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
        currentRoute = status.route;
        updateStatusChip(status.route);
        if (status.fallback) {
          showNotice('Local unavailable — using cloud fallback.');
        }
      },
    });
  }

  /* ── Sending a message ────────────────────────────────────── */
  async function handleSend(overrideText) {
    const userText = overrideText || textarea.value.trim();
    if (!userText || streaming) return;

    textarea.value = '';
    textarea.style.height = 'auto';

    /* Show user bubble */
    appendMessage('user', userText);

    /* Scrape page context on demand */
    if (!cachedPageContext || lastUrl !== location.href) {
      cachedPageContext = extractPageContent(document);
      lastUrl = location.href;
    }

    /* Show skeleton */
    const skeleton = createSkeleton();
    messageList.appendChild(skeleton);
    autoScroll();

    /* Prepare assistant bubble (will fill via deltas) */
    const assistantBubble = el('div', { className: 'gwc-msg gwc-msg-assistant' });
    assistantTextNode = document.createTextNode('');
    assistantBubble.appendChild(assistantTextNode);

    streaming = true;
    setStreamingUI(true);

    ensureChatSession();

    /* Remove skeleton once first delta arrives — watch via mutation */
    const removeSkeleton = () => {
      if (skeleton.parentNode) skeleton.parentNode.removeChild(skeleton);
    };
    const origOnDelta = chatSession._origOnDelta;

    let skeletonRemoved = false;
    const checkSkeleton = () => {
      if (!skeletonRemoved && assistantTextNode.textContent.length > 0) {
        skeletonRemoved = true;
        removeSkeleton();
        messageList.appendChild(assistantBubble);
      }
    };

    /* Wrap the onDelta to detect first delta */
    const realOnDelta = chatSession._callbacks?.onDelta;

    /* Use a simpler approach: poll briefly or use MutationObserver */
    const skeletonWatcher = setInterval(() => {
      checkSkeleton();
      if (!streaming) {
        clearInterval(skeletonWatcher);
        removeSkeleton();
        if (!skeletonRemoved) {
          messageList.appendChild(assistantBubble);
        }
      }
    }, 50);

    chatSession.send(userText, cachedPageContext);
  }

  function handleStop() {
    if (chatSession) chatSession.stop();
    streaming = false;
    setStreamingUI(false);
  }

  /* ── UI helpers ───────────────────────────────────────────── */
  function appendMessage(role, text) {
    const bubble = el('div', {
      className: `gwc-msg gwc-msg-${role}`,
      textContent: text,
    });
    messageList.appendChild(bubble);
    autoScroll();
  }

  function createSkeleton() {
    return el('div', { className: 'gwc-skeleton', 'aria-label': 'Loading' }, [
      el('div', { className: 'gwc-skeleton-line' }),
      el('div', { className: 'gwc-skeleton-line' }),
      el('div', { className: 'gwc-skeleton-line' }),
    ]);
  }

  function setStreamingUI(isStreaming) {
    sendBtn.style.display = isStreaming ? 'none' : '';
    stopBtn.style.display = isStreaming ? '' : 'none';
    textarea.disabled = isStreaming;
    sendBtn.disabled = isStreaming;
  }

  function updateStatusChip(route) {
    statusChip.textContent = route === 'cloud' ? 'CLOUD' : 'LOCAL';
    statusChip.className = 'gwc-status-chip ' + (route === 'cloud' ? 'cloud' : 'local');
  }

  function showError(err) {
    const banner = el('div', { className: 'gwc-error-banner' }, [
      el('span', { className: 'gwc-error-banner-text', textContent: err.friendlyMessage || err.message }),
      err.action
        ? el('button', {
            className: 'gwc-error-banner-btn',
            textContent: err.action,
            onClick: () => {
              if (banner.parentNode) banner.parentNode.removeChild(banner);
              if (err.action === 'Retry') handleSend();
              if (err.action === 'Download Ollama') {
                window.open('https://ollama.com/download', '_blank', 'noopener,noreferrer');
              }
            },
          })
        : null,
    ].filter(Boolean));
    messageList.appendChild(banner);
    autoScroll();
  }

  function showNotice(text) {
    const notice = el('div', {
      className: 'gwc-cached-label',
      textContent: '💡 ' + text,
    });
    messageList.appendChild(notice);
    autoScroll();
  }

  function autoScroll() {
    const threshold = 60;
    const isAtBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < threshold;
    if (isAtBottom) {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }

  /* ── SVG helper (no innerHTML — builds SVG path via createElementNS) ── */
  function createSVGPath(d) {
    const ns = 'http://www.w3.org/2000/svg';
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    return path;
  }

  /* ── SPA navigation detection ─────────────────────────────── */
  /* We cannot use chrome.webNavigation (needs permission) and we cannot
     monkey-patch pushState in the isolated world (different JS context).
     Instead we poll location.href at a low frequency and listen for
     popstate + hashchange. */
  let pollUrl = location.href;

  function onNavigate() {
    const newUrl = location.href;
    if (newUrl !== pollUrl) {
      pollUrl = newUrl;
      cachedPageContext = null; // invalidate
      /* Optionally show a notice in the drawer */
      if (drawerOpen) {
        showNotice('Page changed — context will refresh on next message.');
      }
    }
  }

  window.addEventListener('popstate', onNavigate);
  window.addEventListener('hashchange', onNavigate);

  /* Low-frequency polling for pushState/replaceState changes */
  setInterval(onNavigate, 2000);

})();
