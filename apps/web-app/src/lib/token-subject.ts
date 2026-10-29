/**
 * The user id (`sub`) inside a session token, READ, NOT VERIFIED — or null.
 *
 * ⚠ For UI preferences only: which person's layout choice the proxy applies
 * (`layoutCookieName`). Anybody can write any `sub` into a token they forge,
 * and all it would get them is somebody else's choice of layout on their own
 * screen — every page still authorises with the real, verified token at the
 * API. Never use this to decide what somebody may see or do.
 *
 * Read without a library, as `renewSessionIfNeeded` reads `exp`: a JWT's
 * payload is base64url JSON. An expired token still names its person, which
 * is right here — the session is renewed in the same request.
 */
export function tokenSubject(token: string | null | undefined): string | null {
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: unknown };
    return typeof json.sub === 'string' && json.sub ? json.sub : null;
  } catch {
    return null;
  }
}
