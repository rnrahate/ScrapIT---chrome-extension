import { expect, test, vi } from 'vitest';
import { isUrlSafe } from '../../src/security/url-policy.js';

vi.mock('dns/promises', () => ({
  default: {
    resolve: async () => ['93.184.216.34']
  }
}));

test('rejects local IP', async () => {
  expect(await isUrlSafe('https://127.0.0.1/')).toBe(false);
});

test('allows safe https URL', async () => {
  expect(await isUrlSafe('https://example.com/')).toBe(true);
});

test('rejects http protocol', async () => {
  expect(await isUrlSafe('http://example.com/')).toBe(false);
});
