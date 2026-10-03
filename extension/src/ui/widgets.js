/**
 * @module widgets
 * Widget renderers for structured model output.
 *
 * Renders map cards and link cards using safe DOM construction.
 * Every payload field is validated before rendering; unknown widget
 * types render their fallback_text.
 */

import { el, safeLink } from './dom.js';

/* ────────────────────────────────────────────────────────────────
 * VALIDATORS — hand-written, no libraries
 * ──────────────────────────────────────────────────────────────── */

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateMapPayload(p) {
  return (
    p &&
    isNonEmptyString(p.name) &&
    isNonEmptyString(p.address) &&
    isFiniteNumber(p.lat) &&
    isFiniteNumber(p.lng) &&
    p.lat >= -90 && p.lat <= 90 &&
    p.lng >= -180 && p.lng <= 180
  );
}

function validateLinkCardPayload(p) {
  return (
    p &&
    isNonEmptyString(p.title) &&
    isNonEmptyString(p.url) &&
    isNonEmptyString(p.hostname)
  );
}

/* ────────────────────────────────────────────────────────────────
 * RENDERERS
 * ──────────────────────────────────────────────────────────────── */

/**
 * Render a map placeholder card.
 * No iframes, no external map tiles — a styled static card with
 * place name, address, lat/lng, and an "Open in OpenStreetMap" link.
 */
function renderMapCard(payload) {
  if (!validateMapPayload(payload)) return null;

  const osmUrl = payload.osm_url ||
    `https://www.openstreetmap.org/?mlat=${payload.lat}&mlon=${payload.lng}#map=16/${payload.lat}/${payload.lng}`;

  const card = el('div', { className: 'widget-card widget-map' }, [
    el('div', { className: 'widget-card-icon', textContent: '📍' }),
    el('div', { className: 'widget-card-body' }, [
      el('h4', { className: 'widget-card-title', textContent: payload.name }),
      el('p', { className: 'widget-card-subtitle', textContent: payload.address }),
      el('p', { className: 'widget-card-meta' }, [
        `Lat ${payload.lat.toFixed(5)}, Lng ${payload.lng.toFixed(5)}`,
      ]),
      safeLink(osmUrl, 'Open in OpenStreetMap', { className: 'widget-card-action' }),
    ]),
  ]);

  return card;
}

/**
 * Render a link card (title, hostname, description, verified badge, open button).
 */
function renderLinkCard(payload) {
  if (!validateLinkCardPayload(payload)) return null;

  const children = [
    el('div', { className: 'widget-card-body' }, [
      el('div', { className: 'widget-card-header-row' }, [
        el('h4', { className: 'widget-card-title', textContent: payload.title }),
        payload.verified
          ? el('span', { className: 'widget-badge-verified', textContent: '✓ Verified', 'aria-label': 'Verified link' })
          : null,
      ].filter(Boolean)),
      el('p', { className: 'widget-card-hostname', textContent: payload.hostname }),
      payload.description
        ? el('p', { className: 'widget-card-description', textContent: payload.description })
        : null,
      safeLink(payload.url, 'Open', { className: 'widget-card-action' }),
    ].filter(Boolean)),
  ];

  return el('div', { className: 'widget-card widget-link' }, children);
}

/* ────────────────────────────────────────────────────────────────
 * PUBLIC DISPATCHER
 * ──────────────────────────────────────────────────────────────── */

const RENDERERS = {
  map: renderMapCard,
  link_card: renderLinkCard,
};

/**
 * Render a widget from a stream event.
 * Returns an HTMLElement on success, or a fallback text element.
 *
 * @param {{ widgetType: string, payload: object, fallbackText: string }} widgetEvent
 * @returns {HTMLElement}
 */
export function renderWidget(widgetEvent) {
  const renderer = RENDERERS[widgetEvent.widgetType];

  if (renderer) {
    const rendered = renderer(widgetEvent.payload);
    if (rendered) return rendered;
  }

  /* Unknown type or validation failure → render fallback text */
  return el('div', { className: 'widget-fallback', textContent: widgetEvent.fallbackText || 'Widget unavailable' });
}
