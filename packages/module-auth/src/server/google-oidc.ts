import { createHash, randomBytes } from 'node:crypto';
import { decodeJwtPayload } from '../domain/federated.js';
import type { GoogleSignInStart } from '../types.js';
import type { GoogleClientOptions } from './auth.options.js';

/**
 * The two HTTP conversations "Sign in with Google" needs, and nothing else.
 *
 * Deliberately no Google SDK and no OpenID client library. The whole protocol
 * used here is one redirect URL and one form POST, and a library would bring a
 * JWKS cache, a discovery fetch and a dependency tree to do what these forty
 * lines do — while making the security-relevant choices (PKCE, nonce, where
 * the ID token comes from) harder to see. Those choices are the review.
 *
 * What the ID token is trusted for, and why no signature check: see
 * `decodeJwtPayload` in ../domain/federated.ts. The token is read ONLY from the
 * token endpoint's TLS response here, which OpenID Connect Core §3.1.3.7
 * accepts in place of verifying the signature.
 */

/** Where the browser goes to choose a Google account. */
export const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

/** Where this server trades the authorization code for tokens. */
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/**
 * `openid` for the ID token, `email` for the address that gates linking,
 * `profile` for a display name. Nothing that reaches the user's Google data —
 * no API is called on their behalf, which is also why no access token is kept.
 */
export const GOOGLE_SCOPES = 'openid email profile';

/** Milliseconds before the token exchange is abandoned. A hung request must not hold a sign-in open. */
export const GOOGLE_EXCHANGE_TIMEOUT_MS = 10_000;

/**
 * Mints the three per-attempt values and the URL that carries them.
 *
 * 256 bits each, base64url. `codeVerifier` is 43 characters, the minimum RFC
 * 7636 allows, and its S256 challenge is what goes in the URL — the verifier
 * itself never leaves the servers until the exchange.
 */
export function startGoogleSignIn(client: GoogleClientOptions): GoogleSignInStart {
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // Always show the account chooser. Without it, a browser signed in to one
    // Google account goes straight through as that account, and a person with
    // a work and a personal account cannot pick the one this site knows.
    prompt: 'select_account',
  }).toString();

  return { authorizationUrl: url.toString(), state, nonce, codeVerifier };
}

/**
 * Trades an authorization code for the ID token's claims, or null.
 *
 * Null for EVERY failure — Google refusing the code, a network error, a
 * timeout, a body with no `id_token` — because the caller does the same thing
 * in each case: refuses the sign-in with one message. The distinction goes to
 * the operator through `onAuthFailure`, not to the browser.
 */
export async function exchangeGoogleCode(
  client: GoogleClientOptions,
  input: { code: string; codeVerifier: string },
): Promise<Record<string, unknown> | null> {
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        code_verifier: input.codeVerifier,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: client.redirectUri,
      }).toString(),
      signal: AbortSignal.timeout(GOOGLE_EXCHANGE_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const body = (await response.json().catch(() => null)) as { id_token?: unknown } | null;
  if (typeof body?.id_token !== 'string') return null;
  return decodeJwtPayload(body.id_token);
}
