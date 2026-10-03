import { z } from 'zod';

export const envelopeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    content: z.string(),
  }),
  z.object({
    type: z.literal('widget_render'),
    widget: z.enum(['map', 'link_card']),
    result_id: z.string(),
    fallback_text: z.string(),
  })
]);
