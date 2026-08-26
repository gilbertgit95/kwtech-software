import { DEFAULT_API_URL, DEFAULT_COOKIE_NAME } from '@kwtech/module-auth/next';
import { z } from 'zod';

/**
 * A boot-time assertion, not a value the app threads around.
 *
 * `@kwtech/module-auth/next` reads `API_URL` and `SESSION_COOKIE` itself — that
 * is what makes adopting it a one-line route file instead of a wiring layer.
 * The cost of a convention like that is silence: a typo in `API_URL` does not
 * fail, it falls back to localhost, and the first symptom is a sign-in that
 * hangs in staging.
 *
 * So this checks the same contract the module publishes, once, at startup (see
 * ../instrumentation.ts). The DEFAULTS ARE IMPORTED rather than repeated —
 * otherwise this file and the module would each own a fallback and they would
 * drift, which is a worse failure than the one this prevents.
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

const envSchema = z.object({
  /**
   * Deliberately NOT `NEXT_PUBLIC_`. The browser never talks to the API
   * directly — it talks to this app's own route handlers, which hold the tokens
   * in httpOnly cookies. Exposing the API origin to the client would invite
   * exactly the arrangement that design exists to prevent.
   */
  API_URL: z.url().default(DEFAULT_API_URL),
  /**
   * Encrypts nothing — it names the cookie. Kept configurable so two
   * deployments on sibling subdomains do not overwrite each other's session.
   */
  SESSION_COOKIE: z.string().min(1).default(DEFAULT_COOKIE_NAME),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * THE PRODUCT NAME — the wordmark in the side drawer and the browser tab.
   *
   * Deliberately NOT `NEXT_PUBLIC_`. That prefix inlines a value at BUILD time,
   * so one image could never be deployed twice under two names, and renaming
   * the product would mean rebuilding rather than restarting. The drawer is a
   * client component, so the name is read on the server and passed down as a
   * prop — which costs nothing and keeps the value a runtime one.
   *
   * ⚠️ `apps/web-server` has its own `APP_NAME` for emails and the
   * authenticator entry. Separate processes, separate environments, no shared
   * configuration: set both, and keep them equal.
   */
  APP_NAME: z.string().min(1).default('KWTech'),

  /**
   * The quieter second line under the wordmark. Optional because not every
   * product has one, and an empty line is better than an invented one.
   */
  APP_TAGLINE: optionalText,
});

export type Env = z.infer<typeof envSchema>;

/** Throws on a malformed environment, so the process dies at boot rather than at first sign-in. */
export function assertEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment:', z.flattenError(parsed.error).fieldErrors);
    throw new Error('Invalid environment. See the logged field errors.');
  }
  return parsed.data;
}

/**
 * The product name, for a SERVER component.
 *
 * A function rather than a module-level constant: this file is imported by the
 * app shell, and a constant evaluated at import would be read once when the
 * server module is first loaded rather than per request. Reading it here also
 * keeps the value out of any client bundle that transitively imports this
 * module — there is nothing to inline.
 *
 * Falls back to the same defaults the schema declares, so a call that somehow
 * precedes `assertEnv()` still renders a name instead of "undefined".
 */
export function appBrand(): { name: string; tagline: string | null } {
  return {
    name: process.env.APP_NAME?.trim() || 'KWTech',
    tagline: process.env.APP_TAGLINE?.trim() || null,
  };
}
