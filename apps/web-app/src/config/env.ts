import { z } from 'zod';

/**
 * Server-side configuration for the Next app.
 *
 * `API_URL` is deliberately NOT `NEXT_PUBLIC_`. The browser never talks to the
 * API directly — it talks to this app's own route handlers, which hold the
 * tokens in httpOnly cookies. Exposing the API origin to the client would
 * invite exactly the arrangement that design exists to prevent.
 */
const envSchema = z.object({
  API_URL: z.url().default('http://localhost:8080/api/v1'),
  /**
   * Encrypts nothing — it names the cookie. Kept configurable so two
   * deployments on sibling subdomains do not overwrite each other's session.
   */
  SESSION_COOKIE: z.string().default('kwtech_session'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', z.flattenError(parsed.error).fieldErrors);
  throw new Error('Invalid environment. See the logged field errors.');
}

export const env = parsed.data;
