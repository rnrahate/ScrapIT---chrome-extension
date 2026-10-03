import { expect, test } from 'vitest';
import { envelopeSchema } from '../../src/agent/output-schema.js';

test('validates text payload', () => {
  const result = envelopeSchema.safeParse({ type: 'text', content: 'hello' });
  expect(result.success).toBe(true);
});

test('validates widget payload', () => {
  const result = envelopeSchema.safeParse({ type: 'widget_render', widget: 'map', result_id: 'r_1', fallback_text: 'fallback' });
  expect(result.success).toBe(true);
});

test('fails on missing fields', () => {
  const result = envelopeSchema.safeParse({ type: 'widget_render' });
  expect(result.success).toBe(false);
});
