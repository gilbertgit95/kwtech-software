/**
 * Cookie plumbing on the Web-standard `Headers`, with no framework import.
 *
 * `next/server`'s NextResponse would be the obvious way to do this and it does
 * not survive the trip: this package is compiled to CommonJS and then run
 * through Next's `transpilePackages`, and a `require("next/server")` inside a
 * transpiled workspace package is rewritten into a binding that is not there at
 * runtime — `ReferenceError: server_1 is not defined`, thrown on the first
 * request rather than at build.
 *
 * Route handlers take and return plain `Request`/`Response`, so avoiding the
 * import costs nothing and buys something: this file works unchanged in any
 * Web-standard runtime, which is the same reason the module talks to the API
 * over fetch rather than through a client library.
 */

export interface CookieAttributes {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  path?: string;
  maxAge?: number;
}

/**
 * One `Set-Cookie` value.
 *
 * The name and value are NOT escaped, deliberately: both are a cookie name this
 * module controls and a JWT, which is base64url and therefore already safe.
 * Encoding a JWT would be a silent behaviour change for anything reading the
 * cookie, and pretending to sanitise arbitrary input here would be worse than
 * not claiming to.
 */
export function serializeCookie(name: string, value: string, attributes: CookieAttributes = {}): string {
  const parts = [`${name}=${value}`];

  if (attributes.path) parts.push(`Path=${attributes.path}`);
  // Explicitly `!== undefined`: Max-Age=0 is how a cookie is deleted, and a
  // truthiness check would drop exactly that case.
  if (attributes.maxAge !== undefined) parts.push(`Max-Age=${attributes.maxAge}`);
  if (attributes.sameSite) parts.push(`SameSite=${attributes.sameSite === 'lax' ? 'Lax' : attributes.sameSite}`);
  if (attributes.secure) parts.push('Secure');
  if (attributes.httpOnly) parts.push('HttpOnly');

  return parts.join('; ');
}

/** Reads one cookie from a request's `Cookie` header. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    if (pair.slice(0, index).trim() === name) return pair.slice(index + 1).trim();
  }
  return null;
}

/** JSON response helper — the shape every handler below returns. */
export function json(body: unknown, init: { status?: number; cookies?: string[] } = {}): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  // `append`, not `set`: two cookies means two Set-Cookie headers, and setting
  // the second would silently discard the first.
  for (const cookie of init.cookies ?? []) headers.append('set-cookie', cookie);

  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}
