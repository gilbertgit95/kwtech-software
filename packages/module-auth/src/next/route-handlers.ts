import type { AuthResult } from '../types.js';
import { type AuthNextConfig, refreshCookieName, resolveConfig } from './config.js';
import { json, readCookie, serializeCookie } from './cookies.js';

/**
 * The browser's only door to the auth API.
 *
 * This exists for one reason: **the tokens must never reach client
 * JavaScript.** The API is a pure bearer-token service and sets no cookies by
 * design — no CSRF surface, and a mobile app uses the identical mechanism — so
 * something has to turn "a JSON body with two tokens" into "an httpOnly cookie
 * the page cannot read". That something has to be a server, and the Next app's
 * own server is the only one on the browser's origin.
 *
 * The alternative — letting the sign-in page call the API and keep the tokens
 * in localStorage or a JS-readable cookie — is the arrangement that turns any
 * XSS anywhere in the app into a full account takeover.
 *
 * It lives in the module rather than in each app because it is the half of the
 * design that is easiest to get subtly wrong and hardest to notice: a missing
 * `httpOnly`, a `sameSite: 'none'`, a sign-out that forgets to revoke. One
 * implementation, reviewed once.
 *
 * ONLY the unauthenticated actions are proxied. This is not a pass-through: a
 * handler that forwarded any path would let the browser reach every endpoint
 * with the session attached, which is the thing being avoided.
 */

interface ProxiedAction {
  path: string;
  setsSession: boolean;
}

const PROXIED: Record<string, ProxiedAction> = {
  signin: { path: '/auth/signin', setsSession: true },
  'forgot-password': { path: '/auth/forgot-password', setsSession: false },
  'reset-password': { path: '/auth/reset-password', setsSession: false },
};

/** Where sign-out sends the browser once the session is gone. */
const SIGNED_OUT_DESTINATION = '/auth/signin';

function sessionCookieOptions(config: AuthNextConfig) {
  return {
    httpOnly: true,
    secure: config.secure,
    // 'lax', not 'none': the cookie is same-origin to the app, and 'none'
    // would send it on any cross-site request that reaches us.
    sameSite: 'lax',
    path: '/',
  } as const;
}

/**
 * Signing out is two separate things, and doing only one of them is the common
 * bug:
 *
 *   1. REVOKE the session server-side, so the refresh token is dead. Without
 *      this, "sign out" only forgets the credential locally — anyone who
 *      captured it still holds a working session for its full week.
 *   2. CLEAR the cookies, so this browser stops presenting it.
 *
 * The cookies are cleared even when step 1 fails. Refusing to sign out because
 * the API is unreachable would leave someone stuck signed in on a shared
 * machine, which is the worse of the two outcomes.
 */
async function handleSignOut(request: Request, config: AuthNextConfig): Promise<Response> {
  const token = readCookie(request, config.cookieName);

  if (token) {
    try {
      await fetch(`${config.apiUrl}/auth/signout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
    } catch {
      // Swallowed on purpose: there is nothing the user can do about it, and
      // the cookie clearing below still has to happen.
    }
  }

  // 303, so the browser follows with a GET. A form POST that redirected with
  // 307 would re-POST to the target.
  const headers = new Headers({ location: new URL(SIGNED_OUT_DESTINATION, request.url).toString() });
  for (const name of [config.cookieName, refreshCookieName(config)]) {
    // Max-Age=0 is the deletion, and it must repeat the attributes the cookie
    // was set with — a browser treats a different Path as a different cookie
    // and would leave the original in place.
    headers.append('set-cookie', serializeCookie(name, '', { httpOnly: true, path: '/', maxAge: 0 }));
  }
  return new Response(null, { status: 303, headers });
}

async function handleProxied(request: Request, action: ProxiedAction, config: AuthNextConfig): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ message: 'Expected a JSON body' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${config.apiUrl}${action.path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // The API attributes the session and rate-limits per IP, and from its
        // side every request comes from this server. Without this, one user's
        // failed sign-ins would throttle everyone.
        'x-forwarded-for': request.headers.get('x-forwarded-for') ?? '',
        'user-agent': request.headers.get('user-agent') ?? '',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    // The API being down must not surface as a stack trace on a sign-in form.
    return json({ message: 'Cannot reach the service. Please try again.' }, { status: 502 });
  }

  const payload = (await upstream.json().catch(() => ({}))) as Partial<AuthResult> & { message?: string };

  if (!upstream.ok) {
    // The API is deliberately vague on this path; pass its message through
    // unchanged rather than inventing a more "helpful" one here.
    return json({ message: payload.message ?? 'Something went wrong.' }, { status: upstream.status });
  }

  if (!action.setsSession) return json({ ok: true }, { status: upstream.status });

  const cookies: string[] = [];
  if (payload.accessToken && payload.refreshToken) {
    // Both tokens, httpOnly. The refresh token especially: it is the one that
    // survives the access token's short life, so it is the one worth stealing.
    for (const [name, value] of [
      [config.cookieName, payload.accessToken],
      [refreshCookieName(config), payload.refreshToken],
    ] as const) {
      cookies.push(serializeCookie(name, value, sessionCookieOptions(config)));
    }
  }
  // Only `{ ok: true }` — the tokens went into the cookies above and must not
  // also travel in a body the page's JavaScript can read.
  return json({ ok: true }, { cookies });
}

/**
 * The POST handler for `app/api/auth/[...action]/route.ts`.
 *
 * A catch-all segment, so ONE file serves every action. Next discovers route
 * handlers from the filesystem and a package cannot inject one, so that file is
 * the irreducible part of adopting this module — but it is a re-export, and it
 * never has to change again when the module gains an action.
 */
export function createAuthRouteHandlers(overrides?: Partial<AuthNextConfig>) {
  return {
    async POST(request: Request, context: { params: Promise<{ action: string[] }> }): Promise<Response> {
      const config = resolveConfig(overrides);
      const { action } = await context.params;
      // A catch-all gives an array; only the first segment names an action, so
      // /api/auth/signin/anything-else is not quietly treated as /signin.
      const name = action.length === 1 ? action[0] : undefined;

      if (name === 'signout') return handleSignOut(request, config);

      const proxied = name ? PROXIED[name] : undefined;
      if (!proxied) return json({ message: 'Not found' }, { status: 404 });

      return handleProxied(request, proxied, config);
    },
  };
}
