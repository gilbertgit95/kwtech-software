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
  /** The response carries tokens that belong in cookies rather than in a body. */
  setsSession: boolean;
  /**
   * The REQUEST needs the session cookie attached as a bearer token.
   *
   * False for everything unauthenticated, and it stays false by default because
   * this object is the allowlist that keeps the browser from reaching the API
   * with the session on arbitrary paths. `verify-mfa` is the deliberate
   * exception: the credential it needs — the half-admitted `mfa` token — is
   * already in the httpOnly cookie the sign-in step set, and the page cannot
   * read it to send it itself. That is the whole reason this flag exists, and
   * an `mfa`-scoped token is refused at every endpoint but that one, so
   * forwarding it widens nothing.
   */
  sendsSession?: boolean;
  /** Upstream method, when it is not POST. The browser always POSTs to us. */
  method?: 'POST' | 'DELETE';
  /**
   * Clear this browser's cookies once the action succeeds.
   *
   * Separate from `setsSession`, which WRITES new ones. Revoking a session row
   * server-side does NOT make this browser forget its cookie, and the access
   * token inside it is verified from its signature with no database read — so
   * without this, "sign out everywhere" leaves the device that asked for it
   * working for up to AUTH_ACCESS_TOKEN_TTL. It was exactly that bug once.
   */
  clearsSession?: boolean;
}

const PROXIED: Record<string, ProxiedAction> = {
  signin: { path: '/auth/signin', setsSession: true },
  'verify-mfa': { path: '/auth/verify-mfa', setsSession: true, sendsSession: true },
  'forgot-password': { path: '/auth/forgot-password', setsSession: false },
  'reset-password': { path: '/auth/reset-password', setsSession: false },

  /*
   * ── the settings surface ────────────────────────────────────────────────
   *
   * All of these need the session forwarded, and none of them sets a cookie:
   * they are things a signed-in person does to their own account. They stay on
   * REST rather than moving to the graph because every one of them takes the
   * CURRENT PASSWORD, which makes them a guessing surface — see AuthResolver.
   */
  'change-password': { path: '/auth/change-password', setsSession: false, sendsSession: true },
  'mfa-enrol': { path: '/auth/mfa/enrol', setsSession: false, sendsSession: true },
  'mfa-confirm': { path: '/auth/mfa/confirm', setsSession: false, sendsSession: true },
  'mfa-recovery-codes': { path: '/auth/mfa/recovery-codes', setsSession: false, sendsSession: true },
  // Removal is a DELETE upstream; this handler only speaks POST, so the method
  // is overridden per-action rather than inferred from the browser's request.
  'mfa-remove': { path: '/auth/mfa/factors', setsSession: false, sendsSession: true, method: 'DELETE' },
  /*
   * `clearsSession`, because revoking the ROW is only half of it. The other half
   * is making this browser stop presenting a token that still verifies — see
   * handleSignOut, which does the same two things for the single-session case.
   *
   * `change-password` deliberately does NOT clear: it revokes every OTHER
   * session and leaves this one alone, because signing someone out of the tab
   * they just used to change their password reads as a failure.
   */
  'signout-all': { path: '/auth/signout-all', setsSession: false, sendsSession: true, clearsSession: true },

  /*
   * ── the graph ───────────────────────────────────────────────────────────
   *
   * A DELIBERATE WIDENING, and worth naming as one. Every other entry above is
   * a single named action, because for REST the unit of authorisation is the
   * PATH — so an allowlist of paths is what stops the browser reaching every
   * endpoint with the session attached.
   *
   * GraphQL has one path and many fields, and the unit of authorisation is the
   * FIELD: JwtAuthGuard runs per resolver, FeatureGuard runs per resolver, and a
   * field nobody may read refuses on its own. Allowlisting operation names would
   * be theatre — the operation name is text the caller chooses.
   *
   * So this forwards the whole body. What keeps it safe is that the guards are
   * on the far side, not that this handler is picky.
   */
  graphql: { path: '/graphql', setsSession: false, sendsSession: true },
};

/**
 * Renews the access token from the refresh cookie.
 *
 * ## Why this needs its own handler
 *
 * `/auth/refresh` takes the refresh token in its BODY, and the browser cannot
 * put it there — the cookie holding it is httpOnly, which is the entire point.
 * So the token is read here, on the server, and moved into the request. That is
 * the same shape as sign-in in reverse: a credential crosses between a cookie
 * and a body, and only something on this origin can do it.
 *
 * ## Why a failure CLEARS
 *
 * A refusal here means the session row is gone — revoked, expired, or signed out
 * from another device. Leaving the cookies in place would let the page keep
 * presenting a token that still verifies by signature for the rest of its life,
 * which is exactly the fifteen-minute window this call exists to close.
 *
 * `expiresAt` is returned because the page needs it to schedule the next call,
 * and it is not a secret — it is a timestamp, not a credential. The TOKENS stay
 * in the cookies.
 */
async function handleRefresh(request: Request, config: AuthNextConfig): Promise<Response> {
  const refreshToken = readCookie(request, refreshCookieName(config));
  const clear = () =>
    [config.cookieName, refreshCookieName(config)].map((name) =>
      serializeCookie(name, '', { httpOnly: true, path: '/', maxAge: 0 }),
    );

  if (!refreshToken) return json({ message: 'Not signed in' }, { status: 401, cookies: clear() });

  let upstream: Response;
  try {
    upstream = await fetch(`${config.apiUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': request.headers.get('x-forwarded-for') ?? '',
        'user-agent': request.headers.get('user-agent') ?? '',
      },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
  } catch {
    /*
     * The API being unreachable is NOT a revoked session, and the cookies are
     * kept. Clearing them here would sign everyone out of a healthy application
     * during a thirty-second deploy — the caller retries instead.
     */
    return json({ message: 'Cannot reach the service.' }, { status: 503 });
  }

  const payload = (await upstream.json().catch(() => ({}))) as Partial<AuthResult> & { message?: string };
  if (!upstream.ok || !payload.accessToken || !payload.refreshToken) {
    return json({ message: payload.message ?? 'Your session has ended.' }, { status: 401, cookies: clear() });
  }

  const cookies = [
    [config.cookieName, payload.accessToken],
    [refreshCookieName(config), payload.refreshToken],
  ].map(([name, value]) => serializeCookie(name as string, value as string, sessionCookieOptions(config)));

  return json({ ok: true, expiresAt: payload.expiresAt ?? null }, { cookies });
}

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
    /*
     * PERSISTENT, not a session cookie.
     *
     * Without Max-Age the browser discards both cookies when it closes, so a
     * seven-day server session was unreachable after a restart — "signed in for
     * a week" meant "until you quit your browser". See DEFAULT_SESSION_MAX_AGE
     * for the shared-machine trade this accepts.
     *
     * Both cookies get the SAME lifetime deliberately. Giving the access cookie
     * the access token's five minutes would delete it while the refresh cookie
     * lived on, and the server would then see a signed-out request it could have
     * renewed — the cookie must outlive the token inside it for middleware to
     * know a refresh is worth attempting.
     */
    maxAge: config.sessionMaxAge,
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

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    // The API attributes the session and rate-limits per IP, and from its
    // side every request comes from this server. Without this, one user's
    // failed sign-ins would throttle everyone.
    'x-forwarded-for': request.headers.get('x-forwarded-for') ?? '',
    'user-agent': request.headers.get('user-agent') ?? '',
  };

  if (action.sendsSession) {
    const token = readCookie(request, config.cookieName);
    // No cookie means no half-admitted sign-in to complete. Refused here rather
    // than forwarded, so the API is not asked to answer for a request that
    // cannot possibly be valid.
    if (!token) return json({ message: 'Your sign-in has expired. Start again.' }, { status: 401 });
    headers.authorization = `Bearer ${token}`;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${config.apiUrl}${action.path}`, {
      method: action.method ?? 'POST',
      headers,
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    // The API being down must not surface as a stack trace on a sign-in form.
    return json({ message: 'Cannot reach the service. Please try again.' }, { status: 502 });
  }

  const payload = (await upstream.json().catch(() => ({}))) as Partial<AuthResult> & { message?: string };
  // Not a secret, and the page cannot work without it: it is what tells the
  // sign-in form to send the user to the challenge instead of to the app. The
  // TOKENS stay in the cookies below — this is the one field of the API's
  // response that crosses back into JavaScript.
  const mfaRequired = payload.mfaRequired === true;

  /*
   * CLEARED EVEN WHEN THE CALL FAILED, and that ordering is the point.
   *
   * The same rule handleSignOut follows: refusing to forget the credential
   * because the API was unreachable, or because the token had already expired,
   * would leave someone stuck signed in on a shared machine — the worse of the
   * two outcomes by a distance. Revoking the row is the half that can fail;
   * forgetting the cookie is the half that must not.
   *
   * Max-Age=0 is the deletion, and it repeats the attributes the cookie was set
   * with: a browser treats a different Path as a different cookie and would
   * leave the original in place.
   */
  if (action.clearsSession) {
    const cleared = [config.cookieName, refreshCookieName(config)].map((name) =>
      serializeCookie(name, '', { httpOnly: true, path: '/', maxAge: 0 }),
    );
    return json(upstream.ok ? (payload as Record<string, unknown>) : { message: payload.message ?? 'Signed out.' }, {
      status: 200,
      cookies: cleared,
    });
  }

  if (!upstream.ok) {
    // The API is deliberately vague on this path; pass its message through
    // unchanged rather than inventing a more "helpful" one here.
    return json({ message: payload.message ?? 'Something went wrong.' }, { status: upstream.status });
  }

  if (!action.setsSession) {
    /*
     * The upstream body is passed through for everything that is not a
     * credential exchange.
     *
     * The `{ ok: true }` collapse exists to stop TOKENS reaching JavaScript, and
     * these responses carry none — they carry the answer the page asked for: a
     * GraphQL `data`/`errors` envelope, an enrolment's `otpauth://` URI, a set of
     * recovery codes. Collapsing those would make the actions useless.
     */
    return json(payload as Record<string, unknown>, { status: upstream.status });
  }

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
  // The tokens went into the cookies above and must not also travel in a body
  // the page's JavaScript can read. `mfaRequired` is the only thing that does.
  return json({ ok: true, mfaRequired }, { cookies });
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
      // Not in PROXIED: the credential it needs is in a cookie the browser
      // cannot read, so the body has to be built here rather than forwarded.
      if (name === 'refresh') return handleRefresh(request, config);

      const proxied = name ? PROXIED[name] : undefined;
      if (!proxied) return json({ message: 'Not found' }, { status: 404 });

      return handleProxied(request, proxied, config);
    },
  };
}
