import { logger } from '../observability/logger.js';

export function guardPageContext(text: string): string {
  const patterns = [
    /ignore previous instructions/i,
    /system prompt/i,
    /you are now/i,
    /execute tool/i,
  ];

  for (const p of patterns) {
    if (p.test(text)) {
      logger.warn('Potential prompt injection detected in page context');
      return `<untrusted_page_content_flagged>\n${text}\n</untrusted_page_content_flagged>`;
    }
  }
  return `<untrusted_page_content>\n${text}\n</untrusted_page_content>`;
}
