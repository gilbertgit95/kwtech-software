// Loads apps/web-server/.env.local, and must be the first import here so the
// file is on process.env before the schema below parses it. See load-env.ts.
import './load-env.js';
import { z } from 'zod';
import { parseTrustProxy } from './trust-proxy.js';

/**
 * Boot-time configuration, validated once.
 *
 * Zod rather than @nestjs/config, following masterdb: a schema that fails at
 * IMPORT time — before Nest builds the DI graph — turns a missing DATABASE_URL
 * or a short AUTH_JWT_SECRET into one clear line, instead of a connection error on
 * the first request or a weak signature nobody notices.
 */

/**
 * An optional string where EMPTY MEANS ABSENT.
 *
 * `MAIL_BRAND=` with nothing after it is how people unset a variable in a .env
 * file, and a bare `.optional()` treats that as present-but-empty and fails the
 * boot with "expected string to have >=1 characters" — which names the variable
 * but not the mistake. Whitespace is trimmed for the same reason: a trailing
 * space in a .env file is invisible and would otherwise become part of a brand
 * name printed in an email subject.
 */
const optionalText = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required — see .env.example'),

    /**
     * 8080 for the API, 8081 for the Next app. Chosen to sit clear of the other
     * Sensorbee repos on this machine — coseller-mono holds 3000/3001 and
     * masterdb 3002/3003 — so every service can run at once.
     */
    PORT: z.coerce.number().int().positive().default(8080),

    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    /**
     * WHICH environment this is — `local`, `staging` or `production` — and a
     * different question from NODE_ENV, which says how the code was built.
     * Staging runs a production build; only this tells it apart.
     *
     * Written into each profile by `pnpm env:new` (scripts/env.mjs), and read by
     * the guards: `db:migrate` and `db:snapshot` run only on local, and
     * `db:restore` refuses production.
     *
     * Unset means `local`, so development needs nothing — EXCEPT in a
     * production build, where the refine below demands it. A deployed host that
     * forgot it would otherwise call itself local and let the local-only
     * commands through.
     */
    APP_ENV: z.enum(['local', 'staging', 'production']).optional(),

    /**
     * THE PRODUCT NAME, and the single source for every place one is shown: the
     * email header and subject line, and the entry an authenticator app lists
     * above the code.
     *
     * One variable because a product is renamed all at once or not at all.
     * Three independent strings is three chances to rename two of them, and the
     * one that gets missed is always the one a customer sees.
     *
     * ⚠️ `apps/web-app` has its OWN `APP_NAME` for the wordmark and the browser
     * tab. They are separate processes with separate environments and no shared
     * configuration, so the value is set twice and the two are expected to
     * match. Nothing enforces it — see that app's .env.example.
     */
    APP_NAME: z.string().min(1).default('KWTech'),

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
     * Which proxies may tell this API a client's address. ⚠ Default OFF — see
     * ./trust-proxy.ts for why trusting the Next server blindly is worse than not.
     */
    TRUST_PROXY: z.string().optional().transform(parseTrustProxy),

    /**
     * Requests a minute per client address, for everything that is not a
     * credential. ⚠ Until TRUST_PROXY names the proxies, every browser reaches
     * the API through the Next server, so this is ONE allowance shared by every
     * person, tab and TV — which is why it is 600 rather than the 120 it was: a
     * few queue consoles re-reading on every call exhausted 120 (§12.69).
     */
    THROTTLE_DEFAULT_LIMIT: z.coerce.number().int().positive().default(600),

    /**
     * Requests a minute per client address where somebody is GUESSING a secret:
     * sign-in, 2FA, password reset, a display code. Kept tight on purpose — it is
     * what slows password guessing. Shared behind the proxy like the default.
     */
    THROTTLE_CREDENTIAL_LIMIT: z.coerce.number().int().positive().default(10),

    /** Where the emailed reset link points — a page in the Next app. */
    AUTH_RESET_URL_BASE: z.url().default('http://localhost:8081/auth/reset-password'),

    /**
     * Where an emailed INVITATION link points — also a page in the Next app.
     *
     * Separate from AUTH_RESET_URL_BASE rather than derived from a shared
     * origin, for the reason the reset one is a whole URL: these are routes,
     * and a route is not something a deployment should have to reconstruct from
     * a base plus a path this file assumes. The two also need not live in the
     * same app forever.
     */
    PERMISSIONS_INVITE_URL_BASE: z.url().default('http://localhost:8081/invitations/accept'),

    /**
     * Where a chat notification sends somebody.
     *
     * ⚠ The CHAT PAGE, not a conversation: there is no per-conversation route —
     * the thread is selected inside the page — so a link carrying an id would
     * 404. It is also the safer default, since a conversation id in a mailbox
     * is a conversation id in a mailbox.
     */
    CHAT_URL_BASE: z.url().default('http://localhost:8081/chat'),

    /**
     * ── realtime ──────────────────────────────────────────────────────────────
     *
     * How many replicas of this service the deployment runs. DECLARED, because
     * a process cannot count its own siblings.
     *
     * It exists for one check, in src/realtime/realtime.pubsub.ts: the
     * in-memory pub/sub engine serves exactly one instance, and past that an
     * event published on one replica never reaches a socket held by another —
     * with no error anywhere. Raising this without setting REDIS_URL fails the
     * boot, which is the loud version of a failure that is otherwise invisible
     * until users report that half of them see nothing.
     *
     * ⚠ With REDIS_URL set this is not consulted at all: the distributed engine
     * serves any number of replicas, including one.
     *
     * ⚠ Its limit, stated rather than discovered: scaling the deployment
     * WITHOUT raising this passes the check while the product is broken. It
     * catches the deliberate scale-up, which is the case that actually happens.
     */
    REALTIME_REPLICAS: z.coerce.number().int().positive().default(1),

    /**
     * The distributed pub/sub backend.
     *
     * ⚠ **THIS ONE VARIABLE IS THE ENGINE SWITCH.** Set it and this process
     * publishes and subscribes through Redis; leave it unset and it uses the
     * in-memory engine, which serves exactly the sockets this process holds.
     * There is nothing else to do — no second flag, no rebuild, no code change.
     *
     * It used to FAIL THE BOOT when set, because the driver was not installed
     * and a three-step migration was written in a comment. That made scaling
     * out — an operational act, usually urgent — need a developer and a
     * release. The driver ships now. See src/realtime/realtime.pubsub.ts.
     *
     * Unset in development, deliberately (PLAN §12.28): one replica, in memory,
     * recorded rather than assumed.
     */
    REDIS_URL: optionalText,

    /**
     * ── mail ──────────────────────────────────────────────────────────────────
     *
     * One URL rather than host/port/user/pass/secure as five variables, because
     * every provider documents its SMTP settings in exactly this form and five
     * variables is five chances to set four of them:
     *
     *   smtps://user:pass@smtp.provider.com:465    implicit TLS
     *   smtp://user:pass@smtp.provider.com:587     STARTTLS
     *   smtp://localhost:1025                      Mailpit, locally
     *
     * OPTIONAL, and unset today — see the refinement below for what that means in
     * each environment, and src/auth/reset-mail.ts for what happens without it.
     * A password lives in this value, so it belongs in a secret store, never in a
     * committed .env.
     */
    SMTP_URL: optionalText,

    /**
     * The From: ADDRESS. Must be one the SMTP provider has verified — an
     * unverified sender is not rejected at send time, it is silently filed as
     * spam, which is the failure mode that looks like "the email never arrived".
     *
     * A bare address is the expected form. The display name a recipient sees is
     * taken from APP_NAME, so a rename does not leave the old name in the one
     * header every inbox puts in its list view. Pass a full `Name <addr@host>`
     * only to override that.
     */
    MAIL_FROM: z.string().min(1).default('no-reply@localhost'),

    /**
     * OVERRIDE ONLY — falls back to APP_NAME, which is what should normally
     * carry it. Set this when the name inside a message must differ from the
     * product's, which in practice means a legal entity rather than a second
     * brand.
     *
     * Still separate from MAIL_FROM: that one is an ADDRESS the provider has
     * verified, this one is prose a reader sees.
     */
    MAIL_BRAND: optionalText,

    /**
     * Encrypts TOTP secrets at rest (auth_mfa_factor.secret).
     *
     * OPTIONAL here and REQUIRED by the module the moment anyone enrols a factor:
     * a TOTP secret is symmetric, so unlike a password hash a stolen database row
     * generates valid codes forever. 32 bytes, base64:
     *
     *   openssl rand -base64 32
     *
     * Separate from AUTH_JWT_SECRET on purpose. One secret for two jobs means a
     * leak of either compromises both, and rotating one to fix an incident
     * silently invalidates the other — here, that would lock every 2FA user out.
     */
    AUTH_MFA_SECRET_KEY: optionalText,

    /**
     * OVERRIDE ONLY — falls back to APP_NAME.
     *
     * Worth setting per environment even so: with the same label everywhere, a
     * developer holding a factor in both dev and production sees two identical
     * entries in their authenticator and cannot tell them apart. "KWTech (dev)"
     * costs nothing and answers that.
     *
     * ⚠️ Changing it does NOT update factors already enrolled — the label is
     * baked into the QR code at enrolment.
     */
    AUTH_MFA_ISSUER_LABEL: optionalText,

    /**
     * "Sign in with Google" — an OAuth client of type "Web application" from
     * the Google Cloud console (APIs & Services → Credentials).
     *
     * All three or none: with none, Google sign-in is off and the sign-in page
     * shows no button. The refine below refuses two of three, which would look
     * configured and fail at the first person to press the button.
     *
     * The redirect URI is the WEB APP's callback, not this API's — the browser
     * comes back to the origin that holds the session cookies. It defaults to
     * `${FRONTEND_URL}/api/auth/google/callback`, and must be registered on the
     * client character for character.
     */
    AUTH_GOOGLE_CLIENT_ID: optionalText,
    AUTH_GOOGLE_CLIENT_SECRET: optionalText,
    AUTH_GOOGLE_REDIRECT_URI: optionalText.pipe(z.url().optional()),
  })
  /**
   * Production must not fall back to the developer conveniences.
   *
   * Checked at BOOT rather than at the endpoint that needs it. Both of these
   * were previously discovered by a user: a reset link that 500s on the form,
   * or an enrolment that refuses after the QR code is already on screen. A
   * deployment that is missing them should never start.
   */
  .refine((env) => env.NODE_ENV !== 'production' || env.APP_ENV !== undefined, {
    path: ['APP_ENV'],
    message: "APP_ENV is required in a production build: 'staging' or 'production' (or 'local' to run one here).",
  })
  .refine((env) => env.NODE_ENV !== 'production' || Boolean(env.SMTP_URL), {
    path: ['SMTP_URL'],
    message:
      'SMTP_URL is required in production — without it a password reset and an organization invitation ' +
      'cannot be delivered, and the development fallback (logging the link) would write a working ' +
      'credential into the logs.',
  })
  .refine((env) => Boolean(env.AUTH_GOOGLE_CLIENT_ID) === Boolean(env.AUTH_GOOGLE_CLIENT_SECRET), {
    path: ['AUTH_GOOGLE_CLIENT_SECRET'],
    message:
      'Google sign-in needs AUTH_GOOGLE_CLIENT_ID and AUTH_GOOGLE_CLIENT_SECRET together — set both, or neither.',
  })
  /**
   * Resolves the two display names down to APP_NAME.
   *
   * Done HERE rather than at each call site so `env.MAIL_BRAND` is a string
   * everywhere, not a `string | undefined` that four different files each have
   * to remember to fall back on — which is how one of them ends up printing
   * "undefined" in a subject line.
   */
  .transform((env) => ({
    ...env,
    APP_ENV: env.APP_ENV ?? 'local',
    MAIL_BRAND: env.MAIL_BRAND ?? env.APP_NAME,
    AUTH_MFA_ISSUER_LABEL: env.AUTH_MFA_ISSUER_LABEL ?? env.APP_NAME,
    AUTH_GOOGLE_REDIRECT_URI:
      env.AUTH_GOOGLE_REDIRECT_URI ?? `${env.FRONTEND_URL.replace(/\/+$/, '')}/api/auth/google/callback`,
    /*
     * A bare address gets the product name attached; one that already carries a
     * display name is left exactly as configured.
     *
     * The From: line is the only part of an email every inbox shows in its list
     * view, so a stale product name there is the most visible way a rename can
     * be half-done. The quotes matter: an unquoted display name containing a
     * comma or a period is not a valid RFC 5322 header.
     */
    MAIL_FROM: env.MAIL_FROM.includes('<')
      ? env.MAIL_FROM
      : `"${(env.MAIL_BRAND ?? env.APP_NAME).replace(/"/g, '')}" <${env.MAIL_FROM}>`,
  }));

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
