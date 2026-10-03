import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  MODEL_BASE_URL: z.string().url(),
  MODEL_NAME: z.string(),
  MODEL_API_KEY: z.string(),
  FALLBACK_MODEL_BASE_URL: z.string().url().optional(),
  FALLBACK_MODEL_NAME: z.string().optional(),
  FALLBACK_MODEL_API_KEY: z.string().optional(),
  SEARCH_PROVIDER: z.enum(['brave', 'tavily']).default('brave'),
  SEARCH_API_KEY: z.string().optional(),
  GEO_PROVIDER: z.enum(['nominatim', 'google']).default('nominatim'),
  GEO_API_KEY: z.string().optional(),
  AUTH_TOKEN_HASH: z.string(),
  ALLOWED_ORIGIN: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = configSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Configuration validation error:', parsed.error.format());
  process.exit(1);
}
export const config = parsed.data;
