import crypto from 'crypto';
import { config } from '../config.js';

export function authenticate(token: string): boolean {
  if (!token) return false;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  if (hash.length !== config.AUTH_TOKEN_HASH.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(config.AUTH_TOKEN_HASH)
  );
}
