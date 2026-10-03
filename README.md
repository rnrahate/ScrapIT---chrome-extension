# Gemma Web Companion

A hybrid AI webpage assistant for Chrome (Manifest V3). Everyday questions and page summaries run on a **local Gemma 4 Edge** model (free, private, low latency). Requests that need live web search, verified links, or maps are routed to a **cloud Gemma 4** agent (26B MoE / 31B Dense) that calls tools and returns structured, hallucination-resistant widgets.

- **Frontend:** Chrome extension (popup + in-page Shadow DOM chat drawer)
- **Backend:** Node.js/TypeScript agent server with tool calling and SSE streaming

> Model identifiers are never hard-coded. Set whatever Gemma 4 tags your Ollama install and your cloud provider actually expose (see [Configuration](#configuration)).

---

## Table of contents

1. [How it works](#how-it-works)
2. [Repository layout](#repository-layout)
3. [Prerequisites](#prerequisites)
4. [Quick start](#quick-start)
5. [Configuration](#configuration)
6. [API contract](#api-contract)
7. [Routing rules](#routing-rules)
8. [Permissions](#permissions)
9. [Security model](#security-model)
10. [Privacy and data flow](#privacy-and-data-flow)
11. [Testing](#testing)
12. [Troubleshooting](#troubleshooting)
13. [Chrome Web Store checklist](#chrome-web-store-checklist)
14. [Roadmap](#roadmap)
15. [License](#license)

---

## How it works

```
 ┌───────────────────────────── Chrome ─────────────────────────────┐
 │                                                                  │
 │  content.js (closed Shadow DOM)        popup.html / popup.js     │
 │  FAB + sliding chat drawer             Summarize + chat + widgets│
 │            │                                   │                 │
 │            └──────── chrome.runtime port ──────┘                 │
 │                              │                                   │
 │                     background.js (service worker)               │
 │              owns ALL network I/O, parsing, abort, retries       │
 └──────────────┬───────────────────────────────┬───────────────────┘
                │ local route                   │ cloud route
                ▼                               ▼
     Ollama @ localhost:11434          Cloud agent server  /v1/chat (SSE)
     Gemma 4 Edge (NDJSON stream)      ├─ Gemma 4 26B/31B (tool calling)
                                       ├─ lookup_location_map → GeoProvider
                                       └─ fetch_verified_link → SearchProvider
```

Key design decisions:

- **All network calls go through the service worker.** Content scripts run under the host page's origin, so calling `http://localhost` from an HTTPS page would hit mixed-content and CORS blocks.
- **Two stream formats, one interface.** Ollama streams NDJSON; the cloud server streams SSE. Both are normalized to `delta | widget | done | error` events.
- **Widgets are built server-side from tool results.** The model can only reference a tool result by id. It can never author a URL, address, or coordinate that reaches the UI.
- **No `eval`, no `innerHTML`, no remote code.** All DOM is built with `createElement` and `textContent`; model output is treated as untrusted text.

---

## Repository layout

```
gemma-web-companion/
├── extension/
│   ├── manifest.json
│   ├── background.js              # service worker: routing, fetch, streaming, abort
│   ├── content.js                 # scraper, FAB, Shadow DOM drawer
│   ├── popup.html
│   ├── popup.css
│   ├── popup.js
│   ├── assets/                    # icons
│   ├── src/
│   │   ├── core/
│   │   │   ├── config.js          # endpoints, limits, timeouts
│   │   │   ├── router.js          # pure regex intent router
│   │   │   ├── scraper.js         # DOM cleaning + 6,000-char chunker
│   │   │   ├── stream-parsers.js  # NDJSON + SSE parsers
│   │   │   ├── cache.js           # chrome.storage.local summary cache
│   │   │   └── health.js          # local runtime health check
│   │   └── ui/
│   │       ├── dom.js             # safe element builder (no innerHTML)
│   │       ├── widgets.js         # map + link-card renderers
│   │       └── chat-controller.js # shared chat logic (popup + drawer)
│   └── tests/
│       └── router.test.js
└── server/
    ├── src/
    │   ├── server.ts
    │   ├── config.ts
    │   ├── routes/chat.ts
    │   ├── agent/                 # orchestrator, system prompt, output schema
    │   ├── tools/                 # lookupLocationMap, fetchVerifiedLink, registry
    │   ├── providers/             # model, search, geo (swappable)
    │   ├── security/              # auth, rate-limit, url-policy, injection-guard
    │   ├── streaming/sse.ts
    │   └── observability/
    ├── tests/
    ├── Dockerfile
    ├── docker-compose.yml
    └── .env.example
```

---

## Prerequisites

| Component | Requirement |
|---|---|
| Browser | Chrome 116+ (or any Chromium browser with MV3 support) |
| Local model | [Ollama](https://ollama.com/download) with a Gemma 4 Edge model pulled |
| Backend | Node.js 20+, npm 10+ (or Docker) |
| Search API key | Brave Search or Tavily (for `fetch_verified_link`) |
| Geocoding | OpenStreetMap Nominatim (no key) or Google Geocoding (key) |
| Cloud model access | An endpoint serving Gemma 4 26B MoE or 31B Dense |

---

## Quick start

### 1. Set up the local model (Ollama)

Install Ollama, then pull your Gemma 4 Edge model:

```bash
ollama pull <your-gemma-4-edge-tag>
ollama list    # confirm the tag appears
```

Allow the extension to call Ollama by setting `OLLAMA_ORIGINS`, then restart Ollama:

```bash
# macOS
launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
# then quit and reopen the Ollama app

# Linux (systemd): add under [Service] via `systemctl edit ollama`
Environment="OLLAMA_ORIGINS=chrome-extension://*"
# then: sudo systemctl daemon-reload && sudo systemctl restart ollama

# Windows (PowerShell), then restart Ollama
setx OLLAMA_ORIGINS "chrome-extension://*"
```

Verify:

```bash
curl http://localhost:11434/api/tags
```

### 2. Start the cloud agent server

```bash
cd server
cp .env.example .env      # fill in values, see Configuration
npm install
npm run dev               # or: npm run build && npm start
```

Docker alternative:

```bash
cd server
docker compose up --build
```

Smoke test the SSE stream:

```bash
curl -N http://localhost:8787/v1/chat \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "dev-1",
    "messages": [{"role":"user","content":"Find the official website for Blue Tokai Coffee"}],
    "pageContext": {"url":"https://example.com","title":"Example","text":"Example page","truncated":false},
    "client": {"locale":"en-IN","version":"0.1.0"}
  }'
```

You should see `delta`, `widget`, and `done` events arrive incrementally.

### 3. Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension/` folder.
4. Copy the extension ID shown on the card. Add it to the server's `ALLOWED_EXTENSION_IDS`.
5. Open the extension's options (or popup settings) and enter your **cloud base URL** and **API token**.
6. Pin the extension, open any article, and click **Summarize**, or use the floating button at the bottom-right of the page.

---

## Configuration

### Server (`server/.env`)

| Variable | Required | Description |
|---|---|---|
| `PORT` | no | HTTP port (default `8787`) |
| `API_TOKENS_HASHED` | yes | Comma-separated SHA-256 hashes of accepted bearer tokens |
| `ALLOWED_EXTENSION_IDS` | yes | Comma-separated extension IDs allowed by CORS/origin check |
| `MODEL_BASE_URL` | yes | Base URL of the Gemma 4 endpoint (OpenAI-compatible or provider-native) |
| `MODEL_NAME` | yes | Cloud model identifier (26B MoE or 31B Dense) |
| `MODEL_API_KEY` | yes | Credential for the model endpoint |
| `SEARCH_PROVIDER` | yes | `brave` or `tavily` |
| `SEARCH_API_KEY` | yes | Search provider key |
| `GEO_PROVIDER` | no | `nominatim` (default) or `google` |
| `GEO_API_KEY` | if google | Google Geocoding key |
| `NOMINATIM_USER_AGENT` | if nominatim | Identifying User-Agent per Nominatim usage policy |
| `MAX_TOOL_ITERATIONS` | no | Tool loop cap (default `4`) |
| `REQUEST_BUDGET_MS` | no | Wall-clock budget per request (default `45000`) |
| `TOOL_TIMEOUT_MS` | no | Per-tool timeout (default `8000`) |
| `RATE_LIMIT_PER_MIN` | no | Per-token request cap |
| `LOG_LEVEL` | no | `info` (default), `debug`, `warn` |

Generate a token hash:

```bash
TOKEN=$(openssl rand -hex 32); echo "token: $TOKEN"; printf '%s' "$TOKEN" | sha256sum
```

### Extension (stored in `chrome.storage`)

| Setting | Default | Description |
|---|---|---|
| Local model tag | _(empty)_ | The Ollama tag for Gemma 4 Edge |
| Local endpoint | `http://localhost:11434` | Ollama base URL |
| Cloud base URL | _(empty)_ | Your deployed server |
| Cloud API token | _(empty)_ | Stored in `chrome.storage.local` |
| Fallback to cloud when local is down | on | Otherwise show the download prompt |
| Max page context | 6,000 chars | Hard cap enforced by the chunker |
| Cache TTL | 24 h | Summary cache lifetime (max 50 entries) |

---

## API contract

### `POST /v1/chat`

**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`

**Request body**

```json
{
  "sessionId": "string (<=64)",
  "messages": [{ "role": "user | assistant", "content": "string (<=4000)" }],
  "pageContext": {
    "url": "https://...",
    "title": "string (<=300)",
    "text": "string (<=6000)",
    "truncated": false
  },
  "client": { "locale": "en-IN", "version": "0.1.0" }
}
```

**Response:** `text/event-stream`

| Event | Data |
|---|---|
| `delta` | `{"text": "..."}` |
| `widget` | `{"type":"widget_render","widget":"map\|link_card","payload":{...},"fallback_text":"..."}` |
| `done` | `{"usage":{"input_tokens":0,"output_tokens":0,"tool_calls":0}}` |
| `error` | `{"code":"...","message":"..."}` |

**Widget payloads**

```json
// map
{ "name": "", "address": "", "lat": 0, "lng": 0, "osm_url": "" }

// link_card
{ "title": "", "url": "", "hostname": "", "description": "", "verified": true }
```

**Model output envelope** (validated server-side; the client never sees raw model JSON)

```json
{ "type": "text", "content": "..." }
{ "type": "widget_render", "widget": "map", "result_id": "r_1", "fallback_text": "..." }
```

### Other endpoints

- `GET /healthz`: liveness (unauthenticated, no secrets)
- `GET /readyz`: checks model, search, and geo provider reachability

### Tools exposed to the cloud model

| Tool | Signature | Behavior |
|---|---|---|
| A | `lookup_location_map(location_name, city_context?)` | Geocodes, scores candidates, returns `ok` or `ambiguous` (never guesses on low confidence) |
| B | `fetch_verified_link(query)` | Searches, applies URL policy (https only, SSRF filters, tracker stripping), sets `verified` by domain-match rule |

---

## Routing rules

The extension uses a pure, unit-tested regex router (`router.js`). Matching is case-insensitive with word boundaries.

**Routes to cloud:** `map`, `location`, `coordinates`, `near` / `nearby`, `directions`, `find website`, `official site/link/page`, `book` / `booking` / `reserve`, `buy` / `purchase` / `order`, `price of`, `where is`.

**Routes to local:** everything else, including summaries and questions about the current page.

Edge cases:

- Local runtime unavailable → cloud (with a one-time notice).
- Cloud not configured and the intent is cloud-only → the user is told what is missing; the query is **not** silently sent to the local model.
- False positives such as "the book I read" are covered by tests in `extension/tests/router.test.js`.

---

## Permissions

| Permission | Why it is needed |
|---|---|
| `activeTab` | Read the current page's text only after the user interacts with the extension |
| `scripting` | Inject or message the content script for on-demand extraction |
| `storage` | Cache summaries and store settings and the API token |
| Host: `http://localhost:11434/*`, `http://127.0.0.1:11434/*` | Talk to the local Ollama runtime from the service worker |
| Host: your cloud API origin | Call the cloud agent from the service worker |

**Trade-off:** a floating button on every page requires a content script with `<all_urls>` matching, which triggers a broad host-permission warning at install. A config flag switches to on-demand injection via `chrome.scripting.executeScript` after the user clicks the toolbar icon, which avoids the broad warning but removes the always-on FAB.

---

## Security model

**Extension**

- MV3 with a strict CSP: `script-src 'self'; object-src 'self'`.
- No `eval`, `new Function`, inline scripts/handlers, CDN scripts, or `innerHTML`/`outerHTML`/`insertAdjacentHTML`.
- Chat UI lives in a **closed Shadow DOM** so host-page CSS cannot affect it and page scripts cannot reach its internals.
- All model output is rendered with `textContent`. Links are parsed with `new URL()`, restricted to `https:` (plus localhost in dev), and opened with `rel="noopener noreferrer"`.
- Page text is passed to models inside delimited tags and marked as untrusted data to mitigate prompt injection.

**Server**

- Constant-time bearer-token comparison against hashed tokens; CORS allowlist limited to your extension origin.
- Per-token and per-IP rate limiting with `Retry-After`.
- Strict Zod validation on every request; body size limit of 64 KB.
- SSRF defenses in the URL policy (no IP literals, localhost, private/link-local ranges; DNS-resolution checks for any server-side fetch).
- Widgets are resolved from stored tool results by id; forged ids or model-authored URLs are dropped.
- Timeouts everywhere, circuit breakers per provider, abort upstream calls on client disconnect, SSE heartbeats every 15 s.
- Logs are structured with request ids; page text and user messages are not logged at `info` level.

---

## Privacy and data flow

| Route | What leaves your device | Where it goes |
|---|---|---|
| Local | Nothing | Stays on `localhost` (Ollama) |
| Cloud | The user's message, recent chat turns, and the cleaned, truncated page text (max 6,000 chars) | Your cloud agent server, then your model provider and, for tool calls, the search/geo providers |

- Cloud routing happens **only** when a prompt matches a cloud intent (or local is unavailable and fallback is on), and the UI shows a "🌐 Cloud Syncing" badge whenever it does.
- The server does not persist conversations or page content by default.
- Summaries are cached locally in `chrome.storage.local` keyed by normalized URL (24 h TTL, 50-entry cap) and never uploaded.

---

## Testing

```bash
# Extension: router unit tests (plain Node assert)
cd extension && node tests/router.test.js

# Server: unit + integration tests
cd server && npm test
```

Server coverage includes URL-policy/SSRF cases, envelope validation and repair, widget resolver rejecting forged ids, geo ambiguity handling, rate limiting, and an end-to-end SSE test with a mocked model client.

**Manual QA checklist**

- [ ] Ollama stopped → download prompt or cloud fallback appears
- [ ] Model tag missing → `ollama pull <tag>` instructions shown
- [ ] Slow or offline network → timeout error with Retry
- [ ] Very large page → truncated to ≤ 6,000 chars with marker
- [ ] SPA navigation → context refreshes when the URL changes
- [ ] Host pages with aggressive global CSS → drawer unaffected
- [ ] Strict-CSP sites (e.g., GitHub) → FAB and drawer still work
- [ ] Reopen on the same URL → cached summary renders instantly with "cached" label
- [ ] Stop button / closing the panel aborts the stream

---

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Health check says runtime is down | Ollama not running, or `OLLAMA_ORIGINS` not set and Ollama not restarted |
| `403` from Ollama | `OLLAMA_ORIGINS` doesn't include `chrome-extension://*` |
| "Model missing" | The configured tag isn't in `ollama list`; pull it or fix the setting |
| Cloud `401` | Token not set in the extension, or its hash is missing from `API_TOKENS_HASHED` |
| Cloud CORS error | Extension ID not in `ALLOWED_EXTENSION_IDS` (the ID changes if you reload from a different folder) |
| Stream stops mid-response | Reverse proxy buffering SSE; disable buffering (e.g., `X-Accel-Buffering: no`) |
| Drawer not appearing on some pages | Restricted pages (`chrome://`, Web Store) block content scripts by design |
| Map widget shows no tiles | By design: maps render as a static card with an OpenStreetMap link, since external frames and tiles are avoided for CSP/review reasons |

---

## Chrome Web Store checklist

- [ ] Single-purpose description: "Summarize and chat about the page you're viewing."
- [ ] Permission justification text matches the [Permissions](#permissions) table
- [ ] Data-use disclosure states what is sent to the cloud, when, and why
- [ ] Privacy policy URL published (no sale of data; no persistence on the server by default)
- [ ] No remotely hosted code; all scripts are packaged
- [ ] Icons (16/48/128), screenshots, and promo tile prepared
- [ ] Tested on a clean Chrome profile with local runtime absent and cloud configured

---

## Roadmap

- WebLLM in-browser fallback when Ollama is not installed
- Options page for per-site enable/disable
- Selection-based "explain this" context menu
- Per-user API keys and usage dashboards on the server
- Optional incremental JSON-field streaming to reduce cloud time-to-first-token

---

HAPPY LEARNING!