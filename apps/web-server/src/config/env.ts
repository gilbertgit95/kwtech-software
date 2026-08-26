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

    /** Where the emailed reset link points — a page in the Next app. */
    AUTH_RESET_URL_BASE: z.url().default('http://localhost:8081/auth/reset-password'),

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
  })
  /**
   * Production must not fall back to the developer conveniences.
   *
   * Checked at BOOT rather than at the endpoint that needs it. Both of these
   * were previously discovered by a user: a reset link that 500s on the form,
   * or an enrolment that refuses after the QR code is already on screen. A
   * deployment that is missing them should never start.
   */
  .refine((env) => env.NODE_ENV !== 'production' || Boolean(env.SMTP_URL), {
    path: ['SMTP_URL'],
    message:
      'SMTP_URL is required in production — without it a password reset cannot be delivered, ' +
      'and the development fallback (logging the link) would write a working credential into the logs.',
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
    MAIL_BRAND: env.MAIL_BRAND ?? env.APP_NAME,
    AUTH_MFA_ISSUER_LABEL: env.AUTH_MFA_ISSUER_LABEL ?? env.APP_NAME,
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
