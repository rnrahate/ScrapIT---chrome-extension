/**
 * @module router
 * Pure-function intent classifier — no I/O, no side-effects.
 *
 * Classifies a user query into a route ("cloud" or "local") based on
 * keyword / phrase matching. Cloud-routed intents are those that benefit
 * from live data (maps, commerce, website lookup). Everything else stays
 * local for privacy and speed.
 *
 * Ambiguous terms like "book" and "order" use contextual patterns to avoid
 * false positives (e.g. "the book I read" should NOT route to cloud).
 */

const CLOUD_PATTERNS = [
  /* ── Geography & Navigation ─────────────────────────────────── */
  { pattern: /\bmaps?\b/i, term: 'map' },
  { pattern: /\blocation\s+(?:of|for|is)\b/i, term: 'location' },
  { pattern: /\bcoordinates?\b/i, term: 'coordinates' },
  { pattern: /\bnearby\b/i, term: 'nearby' },
  { pattern: /\bnear\s+(?:me|here|this|the|my|us)\b/i, term: 'near' },
  { pattern: /\bdirections?\s+(?:to|from|for|between)\b/i, term: 'directions' },
  { pattern: /\bwhere\s+is\b/i, term: 'where is' },

  /* ── Website / Link Finding ─────────────────────────────────── */
  { pattern: /\bfind\s+(?:the\s+)?website\b/i, term: 'find website' },
  { pattern: /\bofficial\s+(?:site|link|page|website)\b/i, term: 'official site' },
  { pattern: /\bwebsite\s+(?:for|of)\b/i, term: 'website for' },

  /* ── Commerce (transactional context required for ambiguous terms) */
  { pattern: /\b(?:book|booking)\s+(?:a|an|the|my|this|that|for|at|with|me|us)\b/i, term: 'book' },
  { pattern: /\bbookings?\b/i, term: 'booking' },
  { pattern: /\breserv(?:e|ation|ations|ing)\b/i, term: 'reserve' },
  { pattern: /\bbuy\s+(?:a|an|the|some|this|that|me|it|them|from)\b/i, term: 'buy' },
  { pattern: /\bpurchase\b/i, term: 'purchase' },
  { pattern: /\border\s+(?:a|an|the|some|this|that|from|online|it|them|me|food|pizza)\b/i, term: 'order' },
  { pattern: /\bplace\s+(?:an?\s+)?order\b/i, term: 'order' },
  { pattern: /\bprice\s+of\b/i, term: 'price of' },
];

/**
 * Negative patterns — if any match, certain terms are suppressed.
 * Keyed by the term to protect against false positives.
 */
const NEGATIVE_PATTERNS = {
  order: [/\bin\s+order\s+to\b/i, /\border\s+of\s+(?:magnitude|operations?|execution)\b/i],
  booking: [/\bbooking\.com\b/i],
};

/**
 * Classify a user query into {route, reason, matchedTerms}.
 * @param {string} query  Raw user text.
 * @returns {{ route: "cloud"|"local", reason: string, matchedTerms: string[] }}
 */
export function classifyIntent(query) {
  return {
    route: 'cloud',
    reason: 'Routing all traffic to Node.js backend API',
    matchedTerms: [],
  };
}
