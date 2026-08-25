// Loads apps/web-server/.env relative to the working directory, and must be the
// first import here so the file is on process.env before the schema below
// parses it. In deployment, where these are real environment variables, a
// missing .env is simply a no-op — and an exported variable always wins.
import 'dotenv/config';
import { z } from 'zod';

/**
 * Boot-time configuration, validated once.
 *
 * Zod rather than @nestjs/config, following masterdb: a schema that fails at
 * IMPORT time — before Nest builds the DI graph — turns a missing DATABASE_URL
 * or a short AUTH_JWT_SECRET into one clear line, instead of a connection error on
 * the first request or a weak signature nobody notices.
 */

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required — see .env.example'),

  /**
   * 8080 for the API, 8081 for the Next app. Chosen to sit clear of the other
   * Sensorbee repos on this machine — coseller-mono holds 3000/3001 and
   * masterdb 3002/3003 — so every service can run at once.
   */
  PORT: z.coerce.number().int().positive().default(8080),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Where the Next app lives. The CORS allow-list and reset links both need it. */
  FRONTEND_URL: z.url().default('http://localhost:8081'),

  /**
   * Signs the access token. Nothing else in the system uses it: a shared secret
   * means a leak of either compromises both, and rotating one silently
   * invalidates the other.
   */
  AUTH_JWT_SECRET: z
    .string()
    .min(32, 'AUTH_JWT_SECRET must be at least 32 characters — generate with `openssl rand -base64 48`'),

  /*
   * The three AUTH_*_TTL variables are read by @kwtech/module-auth itself —
   * see its README, and resolveAuthOptions() for the parsing and the
   * session-longer-than-access-token check that used to live below this.
   *
   * Not re-declared here on purpose. Two owners of one variable means two
   * parsers and two defaults, and the day they disagree the app and the module
   * are each behaving correctly according to a different number.
   */

  /** Browser origins allowed to call this API. Comma-separated; defaults to FRONTEND_URL. */
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean)
        : null,
    ),

  /**
   * SMTP is not wired yet. Without it, `pnpm dev` logs the reset URL to the
   * console so the flow is walkable locally — and refuses to do so when
   * NODE_ENV is production, because a reset link in an aggregated log is a
   * working credential in an aggregated log.
   */
  AUTH_RESET_URL_BASE: z.url().default('http://localhost:8081/auth/reset-password'),
});

/**
 * The session-longer-than-access-token check moved into
 * resolveAuthOptions(): both values are finally known there whatever mix of
 * sources they came from, and it is the module that breaks if they disagree.
 */
const validated = envSchema;

function readEnv() {
  const parsed = validated.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment:', z.flattenError(parsed.error).fieldErrors);
    throw new Error('Invalid environment. See the logged field errors.');
  }
  return parsed.data;
}

export const env = readEnv();
export type Env = z.infer<typeof envSchema>;
