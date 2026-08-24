import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@/config/env';

/**
 * The browser's only door to the auth API.
 *
 * This exists for one reason: **the tokens must never reach client
 * JavaScript.** The API is a pure bearer-token service and sets no cookies by
 * design (no CSRF surface, and a mobile app can use the identical mechanism),
 * so something has to turn "a JSON body with two tokens" into "an httpOnly
 * cookie the page cannot read". That something has to be a server, and this
 * app's own server is the only one on the browser's origin.
 *
 * The alternative — letting the sign-in page call the API and keep the tokens
 * in localStorage or a JS-readable cookie — is the arrangement that turns any
 * XSS anywhere in the app into a full account takeover.
 *
 * Only the three unauthenticated actions are proxied. This is not a general
 * pass-through: a handler that forwarded any path would let the browser reach
 * every endpoint with the session attached, which is the thing being avoided.
 */

const PROXIED = {
  signin: { path: '/auth/signin', setsSession: true },
  'forgot-password': { path: '/auth/forgot-password', setsSession: false },
  'reset-password': { path: '/auth/reset-password', setsSession: false },
} as const;

type Action = keyof typeof PROXIED;

interface AuthResponse {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  message?: string;
}

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  const route = PROXIED[action as Action];
  if (!route) return NextResponse.json({ message: 'Not found' }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Expected a JSON body' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${env.API_URL}${route.path}`, {
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
    return NextResponse.json({ message: 'Cannot reach the service. Please try again.' }, { status: 502 });
  }

  const payload = (await upstream.json().catch(() => ({}))) as AuthResponse;

  if (!upstream.ok) {
    // The API is deliberately vague on this path; pass its message through
    // unchanged rather than inventing a more "helpful" one here.
    return NextResponse.json({ message: payload.message ?? 'Something went wrong.' }, { status: upstream.status });
  }

  if (!route.setsSession) return NextResponse.json({ ok: true }, { status: upstream.status });

  const response = NextResponse.json({ ok: true });
  if (payload.accessToken && payload.refreshToken) {
    // Both tokens, httpOnly. The refresh token especially: it is the one that
    // survives the access token's short life, so it is the one worth stealing.
    for (const [name, value] of [
      [env.SESSION_COOKIE, payload.accessToken],
      [`${env.SESSION_COOKIE}_refresh`, payload.refreshToken],
    ] as const) {
      response.cookies.set(name, value, {
        httpOnly: true,
        // Off in development so the flow works over plain http on localhost.
        secure: env.NODE_ENV === 'production',
        // 'lax', not 'none': the cookie is same-origin to this app, and 'none'
        // would send it on any cross-site request that reaches us.
        sameSite: 'lax',
        path: '/',
      });
    }
  }
  return response;
}
