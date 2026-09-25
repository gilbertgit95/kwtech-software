import { createAuthRouteHandlers, safeLocalPath } from '../src/next/route-handlers.js';

/**
 * The two browser legs of Google sign-in, with the API stubbed at `fetch`.
 *
 * The state check is the CSRF defence on the redirect, and the attempt cookie
 * carries a PKCE verifier — so the tests that matter are the ones that prove a
 * callback without the matching cookie goes nowhere, and that the cookie never
 * outlives the attempt.
 */

const APP = 'http://localhost:8081';
const handlers = createAuthRouteHandlers({
  apiUrl: 'http://api.test/api/v1',
  cookieName: 'kwtech_session',
  secure: false,
  sessionMaxAge: 3600,
});
const params = (action: string[]) => ({ params: Promise.resolve({ action }) });

const START = {
  authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=s1',
  state: 's1',
  nonce: 'n1',
  codeVerifier: 'v1',
};

const realFetch = global.fetch;
let calls: { url: string; body: unknown }[] = [];

function stubApi(respond: (url: string) => Response) {
  calls = [];
  global.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return respond(url);
  }) as typeof fetch;
}

afterEach(() => {
  global.fetch = realFetch;
});

/** Runs the first leg and returns the attempt cookie it set, as a `Cookie` header value. */
async function startAttempt(next = '/chat'): Promise<string> {
  stubApi(() => Response.json(START));
  const response = await handlers.GET(
    new Request(`${APP}/api/auth/google?next=${encodeURIComponent(next)}`),
    params(['google']),
  );
  const cookie = response.headers.get('set-cookie') ?? '';
  return cookie.split(';')[0] ?? '';
}

describe('GET /api/auth/google', () => {
  it('sends the browser to Google and keeps the attempt in a narrow, httpOnly cookie', async () => {
    stubApi(() => Response.json(START));
    const response = await handlers.GET(new Request(`${APP}/api/auth/google?next=/chat`), params(['google']));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(START.authorizationUrl);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^kwtech_session_google=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/auth/google');
    // The verifier is in the cookie, not in the URL the browser is sent to.
    expect(response.headers.get('location')).not.toContain('v1');
  });

  it('falls back to the sign-in page when the API has no Google client', async () => {
    stubApi(() => new Response('{}', { status: 404 }));
    const response = await handlers.GET(new Request(`${APP}/api/auth/google`), params(['google']));
    expect(response.headers.get('location')).toBe(`${APP}/auth/signin?error=google_unavailable`);
  });

  it('404s any other GET — every other action stays a POST', async () => {
    const response = await handlers.GET(new Request(`${APP}/api/auth/signin`), params(['signin']));
    expect(response.status).toBe(404);
  });
});

describe('GET /api/auth/google/callback', () => {
  const callback = (query: string, cookie: string) =>
    handlers.GET(
      new Request(`${APP}/api/auth/google/callback?${query}`, { headers: { cookie } }),
      params(['google', 'callback']),
    );

  it('refuses a callback whose state is not the one this browser started — and forgets the attempt', async () => {
    const cookie = await startAttempt();
    stubApi(() => Response.json({}));
    const response = await callback('code=c1&state=forged', cookie);

    expect(response.headers.get('location')).toBe(`${APP}/auth/signin?error=google`);
    expect(calls).toHaveLength(0);
    expect(response.headers.get('set-cookie')).toMatch(/kwtech_session_google=; Path=\/api\/auth\/google; Max-Age=0/);
  });

  it('refuses a callback with no attempt cookie at all', async () => {
    stubApi(() => Response.json({}));
    const response = await callback('code=c1&state=s1', '');
    expect(response.headers.get('location')).toBe(`${APP}/auth/signin?error=google`);
    expect(calls).toHaveLength(0);
  });

  it('refuses when Google reports an error, such as the person pressing Cancel', async () => {
    const cookie = await startAttempt();
    const response = await callback('error=access_denied&state=s1', cookie);
    expect(response.headers.get('location')).toBe(`${APP}/auth/signin?error=google`);
  });

  it('hands code, verifier and nonce to the API, sets the session, and lands on `next`', async () => {
    const cookie = await startAttempt('/chat');
    stubApi(() => Response.json({ accessToken: 'at', refreshToken: 'rt', mfaRequired: false }));
    const response = await callback('code=c1&state=s1', cookie);

    expect(calls).toEqual([
      { url: 'http://api.test/api/v1/auth/google', body: { code: 'c1', codeVerifier: 'v1', nonce: 'n1' } },
    ]);
    expect(response.headers.get('location')).toBe(`${APP}/chat`);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^kwtech_session_google=;/),
        expect.stringMatching(/^kwtech_session=at;.*HttpOnly/),
        expect.stringMatching(/^kwtech_session_refresh=rt;.*HttpOnly/),
      ]),
    );
  });

  it('continues at the challenge when a second factor is owed, carrying `next`', async () => {
    const cookie = await startAttempt('/chat');
    stubApi(() => Response.json({ accessToken: 'at', refreshToken: 'rt', mfaRequired: true }));
    const response = await callback('code=c1&state=s1', cookie);
    expect(response.headers.get('location')).toBe(`${APP}/auth/verify?next=%2Fchat`);
  });

  it('refuses when the API refuses', async () => {
    const cookie = await startAttempt();
    stubApi(() => Response.json({ message: 'Could not sign in with Google' }, { status: 401 }));
    const response = await callback('code=c1&state=s1', cookie);
    expect(response.headers.get('location')).toBe(`${APP}/auth/signin?error=google`);
    expect(response.headers.getSetCookie().some((c) => c.startsWith('kwtech_session='))).toBe(false);
  });
});

describe('safeLocalPath — `next` survives the round trip only as a local path', () => {
  it.each([
    ['/chat', '/chat'],
    ['//evil.example', '/'],
    ['https://evil.example', '/'],
    ['/\\evil.example', '/'],
    [null, '/'],
  ])('%p → %p', (next, expected) => {
    expect(safeLocalPath(next, '/')).toBe(expected);
  });

  it('sanitises `next` on the way in, so a hostile one lands on the home page', async () => {
    const cookie = await startAttempt('https://evil.example');
    stubApi(() => Response.json({ accessToken: 'at', refreshToken: 'rt', mfaRequired: false }));
    const response = await handlers.GET(
      new Request(`${APP}/api/auth/google/callback?code=c1&state=s1`, { headers: { cookie } }),
      params(['google', 'callback']),
    );
    expect(response.headers.get('location')).toBe(`${APP}/`);
  });
});
