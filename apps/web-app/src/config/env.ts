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
