/**
 * tests/router.test.js
 * Table-driven unit tests for the intent classifier.
 *
 * Run with:  node tests/router.test.js
 *
 * Uses only Node's built-in assert module — no frameworks required.
 */

import assert from 'node:assert/strict';
import { classifyIntent } from '../src/core/router.js';

const TEST_CASES = [
  /* ── Cloud-routed (true positives) ────────────────────────── */
  { input: 'Show me a map of Paris',                    expectedRoute: 'cloud',  label: 'map keyword' },
  { input: 'Where is the nearest coffee shop?',         expectedRoute: 'cloud',  label: 'where is' },
  { input: 'Get directions to the airport',             expectedRoute: 'cloud',  label: 'directions to' },
  { input: 'Find nearby restaurants',                   expectedRoute: 'cloud',  label: 'nearby' },
  { input: 'What are the coordinates of the Eiffel Tower?', expectedRoute: 'cloud', label: 'coordinates' },
  { input: 'Find the official website for NASA',        expectedRoute: 'cloud',  label: 'official website' },
  { input: 'Find website for OpenAI',                   expectedRoute: 'cloud',  label: 'find website' },
  { input: 'What is the website for this company?',     expectedRoute: 'cloud',  label: 'website for' },
  { input: 'Book a hotel in Rome',                      expectedRoute: 'cloud',  label: 'book a (transactional)' },
  { input: 'Make a reservation at the restaurant',      expectedRoute: 'cloud',  label: 'reservation' },
  { input: 'I want to purchase a new laptop',           expectedRoute: 'cloud',  label: 'purchase' },
  { input: 'Buy me a birthday gift',                    expectedRoute: 'cloud',  label: 'buy me' },
  { input: 'Order a pizza from Dominos',                expectedRoute: 'cloud',  label: 'order from' },
  { input: 'What is the price of this item?',           expectedRoute: 'cloud',  label: 'price of' },
  { input: 'Book this for Saturday',                    expectedRoute: 'cloud',  label: 'book this' },
  { input: 'Check hotel bookings',                      expectedRoute: 'cloud',  label: 'bookings' },
  { input: 'Near me sushi places',                      expectedRoute: 'cloud',  label: 'near me' },
  { input: 'Location of the head office',               expectedRoute: 'cloud',  label: 'location of' },
  { input: 'Place an order online',                     expectedRoute: 'cloud',  label: 'place an order' },

  /* ── Local-routed (true negatives — should NOT trigger cloud) */
  { input: 'Summarize this page',                       expectedRoute: 'local',  label: 'summarize (local)' },
  { input: 'The book I read last summer was great',     expectedRoute: 'local',  label: 'false positive: "the book I read"' },
  { input: 'In order to understand this concept',       expectedRoute: 'local',  label: 'false positive: "in order to"' },
  { input: 'What is the main argument?',                expectedRoute: 'local',  label: 'general question' },
  { input: 'Explain the third paragraph',               expectedRoute: 'local',  label: 'page reference' },
  { input: 'Translate to French',                       expectedRoute: 'local',  label: 'translate (local)' },
  { input: 'What does this article say about politics?',expectedRoute: 'local',  label: 'article query (local)' },
  { input: 'The order of operations matters',           expectedRoute: 'local',  label: 'false positive: "order of operations"' },
  { input: '',                                          expectedRoute: 'local',  label: 'empty string' },
  { input: 'How many words are in this text?',          expectedRoute: 'local',  label: 'word count' },
  { input: 'Is this a reliable source?',                expectedRoute: 'local',  label: 'reliability check' },
];

/* ── Run tests ──────────────────────────────────────────────── */
let passed = 0;
let failed = 0;

for (const { input, expectedRoute, label } of TEST_CASES) {
  const result = classifyIntent(input);
  try {
    assert.equal(result.route, expectedRoute, `Route mismatch for "${label}"`);
    assert.ok(Array.isArray(result.matchedTerms), 'matchedTerms should be an array');
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0, 'reason should be a non-empty string');

    if (expectedRoute === 'cloud') {
      assert.ok(result.matchedTerms.length > 0, `Cloud route should have matched terms for "${label}"`);
    }

    passed++;
    console.log(`  ✓  ${label}`);
  } catch (err) {
    failed++;
    console.error(`  ✗  ${label}`);
    console.error(`     Input:    "${input}"`);
    console.error(`     Expected: ${expectedRoute}`);
    console.error(`     Got:      ${result.route}  (terms: ${result.matchedTerms.join(', ') || 'none'})`);
    console.error(`     ${err.message}`);
  }
}

console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed\n`);

if (failed > 0) process.exit(1);
