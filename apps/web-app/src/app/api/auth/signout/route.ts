import { type NextRequest, NextResponse } from 'next/server';
import { env } from '@/config/env';

/**
 * A STATIC route segment, so it wins over the sibling `[action]` proxy — which
 * is deliberate: `[action]` is an allowlist of the three UNAUTHENTICATED
 * endpoints and forwards a JSON body. Signing out needs neither; it needs the
 * cookie this app holds and a redirect afterwards.
 *
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
export async function POST(request: NextRequest) {
  const token = request.cookies.get(env.SESSION_COOKIE)?.value;

  if (token) {
    try {
      await fetch(`${env.API_URL}/auth/signout`, {
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
  const response = NextResponse.redirect(new URL('/auth/signin', request.url), { status: 303 });
  for (const name of [env.SESSION_COOKIE, `${env.SESSION_COOKIE}_refresh`]) {
    response.cookies.set(name, '', { httpOnly: true, path: '/', maxAge: 0 });
  }
  return response;
}
