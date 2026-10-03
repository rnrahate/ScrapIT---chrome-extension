# Gemma Web Companion

A hybrid AI webpage assistant Chrome extension powered by **local Gemma models** (via [Ollama](https://ollama.com)) with optional **cloud API fallback**. Summarize, query, and interact with any web page using on-device or cloud AI — your data stays local whenever possible.

---

## Installation

### 1. Load the Extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked** and select the root directory of this project
4. The Gemma Companion icon appears in your toolbar

### 2. Install & Configure Ollama

1. Download and install [Ollama](https://ollama.com/download)
2. Pull the default model:
   ```bash
   ollama pull gemma3:4b
   ```
3. **Set OLLAMA_ORIGINS** so the extension can communicate with Ollama:
   ```bash
   # macOS / Linux
   export OLLAMA_ORIGINS="chrome-extension://*"
   ollama serve

   # Windows (PowerShell)
   $env:OLLAMA_ORIGINS="chrome-extension://*"
   ollama serve
   ```
   Alternatively, add `OLLAMA_ORIGINS=chrome-extension://*` to your system environment variables so it persists across restarts.

4. Verify Ollama is running:
   ```bash
   curl http://localhost:11434/api/tags
   ```

### 3. Cloud API (Optional)

If you want cloud fallback when Ollama is unavailable:

1. Set your cloud API base URL and API key in the extension's settings (via `chrome.storage.sync`)
2. The extension will automatically fall back to the cloud if the local runtime is down (configurable via `AUTO_CLOUD_FALLBACK`)

---

## Configuration

All configuration is in [`src/core/config.js`](src/core/config.js) with sensible defaults. Override any value via `chrome.storage.sync` under the `config` key:

| Key | Default | Description |
|-----|---------|-------------|
| `LOCAL_BASE_URL` | `http://localhost:11434` | Ollama API base URL |
| `CLOUD_BASE_URL` | `""` | Cloud API base URL (empty = disabled) |
| `GEMMA_MODEL_TAG` | `gemma3:4b` | Ollama model tag to use |
| `MAX_CONTEXT_CHARS` | `6000` | Max page content characters sent to the model |
| `NUM_CTX` | `4096` | Context window size for Ollama |
| `AUTO_CLOUD_FALLBACK` | `true` | Auto-switch to cloud when local is unavailable |
| `ON_DEMAND_INJECTION` | `false` | Config flag for on-demand content script injection (see below) |
| `CACHE_TTL_MS` | `86400000` | Summary cache TTL (24 hours) |
| `CACHE_MAX_ENTRIES` | `50` | Max cached summaries |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      POPUP / CONTENT SCRIPT                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   dom.js     │  │  widgets.js  │  │ chat-controller.js│  │
│  │ (safe DOM)   │  │ (renderers)  │  │ (port + typewriter)│ │
│  └──────────────┘  └──────────────┘  └────────┬─────────┘  │
│                                                │  port      │
├────────────────────────────────────────────────┼────────────┤
│                   SERVICE WORKER               │            │
│  ┌──────────┐ ┌────────┐ ┌──────────────────┐ │            │
│  │ router.js│ │health.js│ │ stream-parsers.js│ │            │
│  └──────────┘ └────────┘ └──────────────────┘ │            │
│  ┌──────────┐ ┌────────┐                      │            │
│  │ config.js│ │cache.js │     background.js ◄──┘            │
│  └──────────┘ └────────┘     (ALL network I/O)              │
└─────────────────────────────────────────────────────────────┘
          │                        │
          │ fetch (local)          │ fetch (cloud)
          ▼                        ▼
   ┌─────────────┐        ┌──────────────┐
   │   Ollama    │        │  Cloud API   │
   │ localhost:  │        │  /v1/chat    │
   │ 11434      │        │  (SSE)       │
   └─────────────┘        └──────────────┘
```

### Key Design Decisions

- **Network isolation**: Content script and popup **never** call `fetch` directly. All I/O goes through the service worker via `chrome.runtime.connect` (streaming) or `chrome.runtime.sendMessage` (RPC).
- **Service worker keepalive**: Open ports keep the MV3 worker alive. A 20-second heartbeat message provides an extra safety net (Chrome's idle timeout is 30s).
- **Shadow DOM isolation**: The in-page drawer uses `attachShadow({mode: 'closed'})` with `all: initial` to prevent host-page CSS from leaking in.
- **Prompt injection mitigation**: Page content is wrapped in `<page_context>` tags with explicit instructions to the model to treat it as untrusted data.

---

## Permission Justification

| Permission | Why Needed |
|------------|------------|
| `activeTab` | Required to access the active tab's URL and send messages to the content script for scraping page content. Only activates when the user clicks the extension icon or interacts with the drawer. |
| `scripting` | Used for on-demand content script injection when `ON_DEMAND_INJECTION` is enabled, as an alternative to the `<all_urls>` content script declaration. |
| `storage` | Stores user configuration (`chrome.storage.sync`), cloud API keys (`chrome.storage.local`), and the summary cache (`chrome.storage.local`) with TTL-based eviction. |
| `host_permissions: localhost:11434` | Required for the service worker to make cross-origin requests to the local Ollama API, which doesn't serve CORS headers. |
| `optional_host_permissions: https://*/*` | Requested at runtime when the user configures a cloud API endpoint, granting fetch access to that specific origin. |

---

## Content Script Injection: `<all_urls>` vs On-Demand

The default configuration uses a manifest-declared content script matching `<all_urls>`, which triggers a **broad host permission warning** at install ("Read and change all your data on all websites"). This is the simplest approach and provides the best UX (the FAB is always visible).

**Alternative: On-Demand Injection** (`ON_DEMAND_INJECTION: true`)

Set this config flag to skip the manifest content script and instead inject on click via `chrome.scripting.executeScript` from the service worker after the user clicks the extension icon. Benefits:
- No broad host permission warning at install
- Content script only runs on pages where the user explicitly activates the extension

Trade-off: The FAB won't be visible until the user clicks the extension icon.

---

## Web Accessible Resources & Fingerprinting

Files listed in `web_accessible_resources` can be probed by any web page to detect whether this extension is installed (fingerprinting). We list only the files strictly needed by the content script's dynamic imports:

- `src/ui/dom.js`, `src/ui/widgets.js`, `src/ui/chat-controller.js` — shared logic
- `src/core/scraper.js`, `src/core/config.js` — page extraction
- `src/ui/drawer.css` — shadow DOM styling (loaded via `fetch` + `adoptedStyleSheets` rather than a `<link>` tag to minimize exposure surface)

**Mitigation**: CSS is loaded via `fetch()` inside the shadow root and applied through `CSSStyleSheet.replaceSync()` / `adoptedStyleSheets`, so no `<link>` element pointing to a detectable extension URL is inserted into the page DOM. The CSS file is listed in `web_accessible_resources` as a fallback; the primary loading path uses the background worker as a CSS proxy (`get-css` RPC).

---

## Cloud API Contract

### Request — `POST /v1/chat`

```json
{
  "sessionId": "uuid-string",
  "messages": [
    { "role": "user", "content": "Summarize this page" }
  ],
  "pageContext": {
    "url": "https://example.com/article",
    "title": "Example Article",
    "text": "...(≤6000 chars)...",
    "truncated": false
  },
  "client": {
    "locale": "en-US",
    "version": "1.0.0"
  }
}
```

### Response — `text/event-stream`

```
event: delta
data: {"text": "Here is "}

event: delta
data: {"text": "a summary."}

event: widget
data: {"type":"widget_render","widget":"map","payload":{"name":"Eiffel Tower","address":"Paris, France","lat":48.8584,"lng":2.2945,"osm_url":"https://..."},"fallback_text":"Eiffel Tower, Paris"}

event: done
data: {"usage":{"promptTokens":120,"completionTokens":85}}
```

### Widget Payloads

| Widget | Payload Fields |
|--------|---------------|
| `map` | `name`, `address`, `lat`, `lng`, `osm_url` |
| `link_card` | `title`, `url`, `hostname`, `description`, `verified` |

---

## Chrome Web Store Compliance Checklist

| Requirement | Status | Notes |
|-------------|--------|-------|
| **Single purpose** | ✅ | AI-powered webpage assistant — summarize, query, and interact with page content |
| **Minimum permissions** | ✅ | Only `activeTab`, `scripting`, `storage`. No `tabs`, `webNavigation`, `history`, etc. |
| **No remote code execution** | ✅ | `script-src 'self'`; no CDN scripts, no `eval()`, no `new Function()`, no inline scripts |
| **Data use disclosure** | ✅ | See below |
| **No deceptive behavior** | ✅ | Extension clearly states when cloud API is used; status chip shows LOCAL vs CLOUD |
| **Privacy policy** | ⬜ | Required before submission — document what data is sent and when |

### Data Use Disclosure

| Data | Leaves Device? | When | Destination |
|------|----------------|------|-------------|
| Page text (≤6000 chars) | **Only if cloud route** | When a cloud-routed query is sent, or local fallback triggers | Configured cloud API endpoint |
| User query text | **Only if cloud route** | Same as above | Configured cloud API endpoint |
| Page text (full) | **Never** (local only) | When a local-routed query is sent | Ollama on `localhost:11434` |
| API key | **Yes** (cloud only) | In the `Authorization` header of cloud requests | Configured cloud API endpoint |
| Extension config | **Never** | Stored in `chrome.storage.sync` | Chrome sync infrastructure only |
| Summary cache | **Never** | Stored in `chrome.storage.local` | Stays on device |

---

## Manual QA Checklist

| Scenario | Test Steps | Expected Behavior |
|----------|-----------|-------------------|
| **Offline (no network)** | Disconnect network, open extension | Shows "Offline" status if Ollama is also unreachable; cached summaries still display instantly |
| **Slow network** | Throttle to 2G in DevTools, send cloud query | Streaming works progressively; timeout error after 60s with Retry action |
| **Ollama not running** | Stop Ollama, click extension | Shows "Runtime Not Found" panel with download link and "Use Cloud" button |
| **Model not pulled** | Run Ollama without the model, click extension | Shows "Model Not Installed" panel with `ollama pull` command |
| **Huge page (50,000+ chars)** | Open a very long Wikipedia article | Scraper truncates to 6000 chars with `[...truncated...]` markers; no UI lag |
| **SPA navigation** | Open a React/Next.js app, navigate between pages | URL change detected; context invalidated; "Page changed" notice shown |
| **Dark-mode host with aggressive CSS** | Open a site with `* { color: white !important }` | Shadow DOM isolation prevents leakage; drawer renders correctly |
| **CSP-strict site** | Open a site with strict CSP headers | Content script runs in isolated world; dynamic imports resolve to extension origin |
| **Cancel mid-stream** | Click Stop during AI response | Stream aborted immediately; partial response preserved |
| **Rapid messages** | Send 5 messages quickly | Each queued and processed in order; typewriter queue doesn't skip |
| **Escape key** | Press Escape while drawer is open | Drawer closes; focus returns to FAB |
| **Keyboard navigation** | Tab to FAB, Enter to open, Tab through UI | All interactive elements focusable; visible focus rings |
| **Dark mode** | Toggle OS dark mode | Both popup and drawer switch themes via `prefers-color-scheme` |
| **Reduced motion** | Enable reduced motion in OS settings | All animations and transitions disabled |
| **Cache hit** | Summarize a page, close popup, reopen | Cached summary renders instantly with "Cached" label |
| **Cache invalidation** | Edit a page's content, re-summarize | New content hash differs; fresh summary generated |

---

## Project Structure

```
├── manifest.json              # MV3 manifest
├── background.js              # Service worker (all network I/O)
├── content.js                 # FAB + Shadow DOM drawer
├── popup.html / .css / .js    # Extension popup
├── src/
│   ├── core/
│   │   ├── config.js          # Endpoints, model tags, limits
│   │   ├── router.js          # Intent classification (pure function)
│   │   ├── scraper.js         # DOM extraction and chunking
│   │   ├── stream-parsers.js  # NDJSON + SSE async iterators
│   │   ├── cache.js           # chrome.storage.local summary cache
│   │   └── health.js          # Ollama runtime health check
│   └── ui/
│       ├── dom.js             # Safe DOM construction helper
│       ├── widgets.js         # Widget renderers (map, link_card)
│       ├── chat-controller.js # Shared chat session logic
│       └── drawer.css         # Shadow DOM styles
├── tests/
│   └── router.test.js         # 30 table-driven intent classifier tests
└── assets/
    └── icons/                 # Extension icons (16, 48, 128)
```

---

## License

MIT