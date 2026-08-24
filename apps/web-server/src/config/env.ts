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
 * or a short JWT_SECRET into one clear line, instead of a connection error on
 * the first request or a weak signature nobody notices.
 */

/**
 * '15m' / '7d' in configuration, seconds in code. Durations are written the way
 * an operator thinks about them and consumed the way jsonwebtoken and Date
 * arithmetic want them, so nothing downstream has to parse a suffix.
 */
const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86_400 } as const;

const duration = (fallback: string) =>
  z
    .string()
    .regex(/^\d+[smhd]$/, "must be a duration like '15m', '24h' or '7d'")
    // Before the transform, not after: .default() in Zod 4 supplies the
    // schema's OUTPUT, and after a transform that output is a number.
    .default(fallback)
    .transform((value) => {
      const unit = value.slice(-1) as keyof typeof UNIT_SECONDS;
      return Number(value.slice(0, -1)) * UNIT_SECONDS[unit];
    });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required — see .env.example'),

  /** 3002 to match masterdb's backend; 3000/3001 belong to coseller-mono. */
  PORT: z.coerce.number().int().positive().default(3002),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Where the Next app lives. The CORS allow-list and reset links both need it. */
  FRONTEND_URL: z.url().default('http://localhost:3003'),

  /**
   * Signs the access token. Nothing else in the system uses it: a shared secret
   * means a leak of either compromises both, and rotating one silently
   * invalidates the other.
   */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters — generate with `openssl rand -base64 48`'),

  /**
   * ── how long someone stays signed in ──────────────────────────────────────
   *
   * ONE WEEK by default, and this is the value that means "stay signed in": it
   * is the session's real lifetime, because the session row is addressed by the
   * refresh token and that row is what decides when someone is signed out.
   * Unset or absent from .env, the fallback below applies.
   */
  AUTH_SESSION_TTL: duration('7d'),

  /**
   * How long before the client silently renews. Deliberately NOT a week.
   *
   * This API verifies an access token from its signature alone — no database
   * read, which is what keeps authentication off the hot path. The cost is the
   * only thing this value controls: **a revoked session stays usable until its
   * current access token expires.** At 15 minutes that is a nuisance; at a week
   * it would mean "sign out everywhere", "suspend this account" and a password
   * reset all do nothing for seven days.
   *
   * (masterdb sets its own ACCESS_TOKEN_TTL to 7d, and can: its guard re-reads
   * the session row on every request, so revocation is immediate there
   * regardless of token life. This service made the opposite trade — see
   * AuthSession in packages/module-auth/prisma/auth.prisma — so the two numbers
   * are not comparable.)
   */
  AUTH_ACCESS_TOKEN_TTL: duration('15m'),

  /** A reset link waits in an inbox, which is the least trustworthy place a credential sits. */
  AUTH_PASSWORD_RESET_TTL: duration('1h'),

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
  AUTH_RESET_URL_BASE: z.url().default('http://localhost:3003/auth/reset-password'),
});

/**
 * A session that dies before the access token it renews produces a sign-out at
 * the first renewal — intermittent and confusing rather than an obvious
 * misconfiguration. Caught at boot instead.
 */
const validated = envSchema.refine((value) => value.AUTH_SESSION_TTL > value.AUTH_ACCESS_TOKEN_TTL, {
  path: ['AUTH_SESSION_TTL'],
  message: 'AUTH_SESSION_TTL must be longer than AUTH_ACCESS_TOKEN_TTL',
});

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
