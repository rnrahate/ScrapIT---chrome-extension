export function redactPii(text: string): string {
  if (typeof text !== 'string') return text;
  return text.replace(/([a-zA-Z0-9_\-\.]+)@([a-zA-Z0-9_\-\.]+)\.([a-zA-Z]{2,5})/g, '[REDACTED_EMAIL]');
}
