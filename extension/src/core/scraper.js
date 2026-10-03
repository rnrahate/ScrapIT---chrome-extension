/**
 * @module scraper
 * Pure, testable DOM extraction and text cleaning.
 *
 * 1. Clone document.body (never mutate the live page).
 * 2. Strip noise elements (ads, nav, modals, cookie banners, etc.).
 * 3. Prefer <main>, <article>, [role=main] as root when present.
 * 4. Extract text via recursive tree-walk (cloned detached nodes have
 *    no layout, so innerText is unreliable — we use a tag-based heuristic
 *    to preserve paragraph breaks).
 * 5. Collapse whitespace, de-duplicate lines.
 * 6. Chunk to a configurable limit using head+middle+tail sampling.
 */

const DEFAULT_MAX_CHARS = 6000;
const HEAD_RATIO = 0.50;
const MIDDLE_RATIO = 0.20;
const TAIL_RATIO = 0.30;

/** Tags to remove entirely from the clone. */
const STRIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG',
  'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'FORM',
]);

/** ARIA roles to remove. */
const STRIP_ROLES = new Set([
  'navigation', 'banner', 'contentinfo',
]);

/** Regex for id / class / aria-label matching junk elements. */
const JUNK_PATTERN =
  /cookie|consent|gdpr|banner|advert|ad-|ads|sponsor|promo|popup|modal|newsletter|subscribe/i;

/** Block-level tags that should produce paragraph breaks in output. */
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS',
  'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE',
  'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER',
  'HR', 'LI', 'MAIN', 'OL', 'P', 'PRE', 'SECTION',
  'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);

/* ────────────────────────────────────────────────────────────────
 * PUBLIC API
 * ──────────────────────────────────────────────────────────────── */

/**
 * Extract cleaned page content.  Returns an object ready to send as
 * pageContext to the service worker.
 *
 * @param {Document} doc          The page document (live).
 * @param {number}   [maxChars]   Character budget (default 6000).
 * @returns {{ text: string, originalLength: number, truncated: boolean,
 *             title: string, url: string, contentHash: string }}
 */
export function extractPageContent(doc, maxChars = DEFAULT_MAX_CHARS) {
  const title = doc.title || '';
  const url = doc.location ? doc.location.href : '';

  if (!doc.body) {
    return { text: '', originalLength: 0, truncated: false, title, url, contentHash: '' };
  }

  /* 1. Clone */
  const clone = doc.body.cloneNode(true);

  /* 2. Strip noise */
  stripNoise(clone);

  /* 3. Prefer semantic root */
  const root = pickSemanticRoot(clone) || clone;

  /* 4. Extract text via tree-walk */
  let rawText = extractTextFromTree(root);

  /* 5. Normalise */
  rawText = normaliseText(rawText);

  const originalLength = rawText.length;
  const contentHash = cheapHash(rawText);

  /* 6. Chunk if over budget (leave room for links) */
  const chunked = chunkText(rawText, maxChars - 1500);
  
  /* 7. Append Links */
  const links = new Set();
  const anchors = root.querySelectorAll('a[href]');
  for (const a of anchors) {
    try {
      const href = a.getAttribute('href');
      if (href && !href.startsWith('javascript:')) {
        const urlObj = new URL(href, doc.location.href);
        if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
          const linkText = (a.textContent || '').replace(/\s+/g, ' ').trim() || 'Link';
          links.add(`[${linkText}](${urlObj.href})`);
        }
      }
    } catch (e) {}
  }
  
  let finalText = chunked.text;
  if (links.size > 0) {
    finalText += '\n\n--- Links found on page ---\n' + Array.from(links).slice(0, 50).join('\n');
  }

  return {
    text: finalText,
    originalLength,
    truncated: chunked.truncated,
    title,
    url,
    contentHash,
  };
}

/* ────────────────────────────────────────────────────────────────
 * INTERNAL HELPERS
 * ──────────────────────────────────────────────────────────────── */

function stripNoise(root) {
  /* Collect elements to remove (avoid mutating while iterating). */
  const toRemove = [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const node = walker.currentNode;

    if (STRIP_TAGS.has(node.tagName)) {
      toRemove.push(node);
      continue;
    }
    const role = (node.getAttribute('role') || '').toLowerCase();
    if (STRIP_ROLES.has(role)) {
      toRemove.push(node);
      continue;
    }
    if (node.getAttribute('aria-hidden') === 'true') {
      toRemove.push(node);
      continue;
    }
    const id = node.id || '';
    const cls = node.className || '';
    const ariaLabel = node.getAttribute('aria-label') || '';
    if (JUNK_PATTERN.test(id) || JUNK_PATTERN.test(cls) || JUNK_PATTERN.test(ariaLabel)) {
      toRemove.push(node);
      continue;
    }
  }

  for (const el of toRemove) {
    if (el.parentNode) el.parentNode.removeChild(el);
  }
}

function pickSemanticRoot(clone) {
  const candidates = [
    clone.querySelector('main'),
    clone.querySelector('article'),
    clone.querySelector('[role="main"]'),
  ];
  for (const c of candidates) {
    if (c && c.textContent.trim().length > 200) return c;
  }
  return null;
}

/**
 * Recursive tree-walk text extractor.
 * Uses tag-based heuristics (since cloned detached nodes have no layout)
 * to insert newlines at block boundaries — approximating innerText
 * behaviour without requiring a rendered tree.
 */
function extractTextFromTree(root) {
  let result = '';
  let lastChar = '\n';

  function visit(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent.replace(/[\t ]+/g, ' ').trim();
      if (!t) return;
      if (lastChar !== '\n' && lastChar !== ' ') result += ' ';
      result += t;
      lastChar = t[t.length - 1];
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.tagName === 'BR') {
      result += '\n';
      lastChar = '\n';
      return;
    }

    const isBlock = BLOCK_TAGS.has(node.tagName);
    if (isBlock && result.length > 0 && lastChar !== '\n') {
      result += '\n';
      lastChar = '\n';
    }

    for (const child of node.childNodes) {
      visit(child);
    }

    if (isBlock && lastChar !== '\n') {
      result += '\n';
      lastChar = '\n';
    }
  }

  visit(root);
  return result;
}

function normaliseText(text) {
  /* Collapse runs of blank lines, de-duplicate repeated lines. */
  const lines = text.split('\n');
  const seen = new Set();
  const deduped = [];

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      /* Preserve one blank line at most */
      if (deduped.length > 0 && deduped[deduped.length - 1] !== '') {
        deduped.push('');
      }
      continue;
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      deduped.push(trimmed);
    }
  }

  return deduped.join('\n').trim();
}

/**
 * Head + middle-sample + tail chunking with sentence-boundary cuts.
 */
function chunkText(text, maxChars) {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  const markerLen = '\n\n[...truncated...]\n\n'.length;
  const budget = maxChars - markerLen * 2;
  const headSize = Math.floor(budget * HEAD_RATIO);
  const middleSize = Math.floor(budget * MIDDLE_RATIO);
  const tailSize = budget - headSize - middleSize;

  const head = cutAtBoundary(text, 0, headSize, 'end');
  const midStart = Math.floor((text.length - middleSize) / 2);
  const middle = cutAtBoundary(text, midStart, midStart + middleSize, 'both');
  const tail = cutAtBoundary(text, text.length - tailSize, text.length, 'start');

  return {
    text: head + '\n\n[...truncated...]\n\n' + middle + '\n\n[...truncated...]\n\n' + tail,
    truncated: true,
  };
}

/**
 * Cut text at a sentence or paragraph boundary.
 * @param {'start'|'end'|'both'} side  Which end(s) to snap.
 */
function cutAtBoundary(text, from, to, side) {
  let segment = text.slice(from, to);

  if (side === 'end' || side === 'both') {
    const lastStop = segment.lastIndexOf('. ');
    const lastNewline = segment.lastIndexOf('\n');
    const best = Math.max(lastStop, lastNewline);
    if (best > segment.length * 0.6) {
      segment = segment.slice(0, best + 1);
    }
  }

  if (side === 'start' || side === 'both') {
    const firstStop = segment.indexOf('. ');
    const firstNewline = segment.indexOf('\n');
    const candidates = [firstStop, firstNewline].filter((i) => i > 0);
    const best = candidates.length ? Math.min(...candidates) : -1;
    if (best > 0 && best < segment.length * 0.3) {
      segment = segment.slice(best + 1);
    }
  }

  return segment.trim();
}

/**
 * Cheap string hash (DJB2) for cache invalidation — NOT cryptographic.
 */
function cheapHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
