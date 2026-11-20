/**
 * Where a `?next=` may send somebody: a path on this origin, and nothing else.
 *
 * ⚠ ONE rule for every place that follows a `next` (#179): the sign-in page,
 * the MFA challenge, sign-out and Google sign-in's round trip. It used to be
 * two, and the browser's copy was the weaker one: a value the server refused
 * reached `window.location.assign` from the sign-in page. A link on the real
 * origin that signs you in and then drops you on a look-alike page is a
 * working phishing flow, which is why an open redirect is the thing to get
 * wrong here.
 *
 *   '/x'    yes
 *   '//evil.example'  no — protocol-relative, a different host
 *   'https://evil.example'  no
 *   '/\evil.example'  no — browsers read the backslash as '/'
 *   '/<tab>/evil.example'  no — browsers drop tabs and newlines from a URL
 *   'auth/signin'  no — relative to wherever the page happens to be
 *
 * The prefixes are refused by name AND the value is then resolved against an
 * origin and must still be on it. The list alone is how the weaker copy
 * happened: every browser normalisation nobody listed was a way through.
 */

/** Any origin will do: the question is only whether resolving `next` LEAVES it. */
const PROBE_ORIGIN = 'https://local-path.invalid';

/**
 * `next` if it is a path on this origin, else `fallback`.
 *
 * Falls back rather than refusing: at every caller the person has already
 * signed in or out, and failing that over a malformed query parameter would be
 * the worse outcome.
 */
export function safeLocalPath(next: string | null | undefined, fallback: string): string {
  if (!next?.startsWith('/')) return fallback;
  if (next.startsWith('//')) return fallback;
  /*
   * A backslash anywhere, and every control character. A control character in
   * a Location header is header injection, not a path, and a browser strips
   * tabs and newlines before it resolves, which turns '/\t/host' into '//host'.
   * A real path in this app never holds either.
   */
  // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point.
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;

  let resolved: URL;
  try {
    resolved = new URL(next, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  return resolved.origin === PROBE_ORIGIN ? next : fallback;
}

/** The sign-in page, as the shells send a signed-out reader to it. */
const SIGN_IN_PATH = '/auth/signin';

/**
 * Where to send somebody who asked for `requested` signed out: the sign-in
 * page, carrying the address back when there is one worth carrying (#181).
 *
 * Without it the shells sent everybody to a bare `/auth/signin`, and a link
 * opened signed out (a receipt, a notice, a page somebody shared) ended on
 * the home page once they had signed in.
 *
 * Nothing is carried for the home page (where sign-in lands anyway), for the
 * auth pages themselves (signing in to come back to the sign-in page is a
 * loop), or for anything `safeLocalPath` refuses.
 */
export function signInPathFor(requested: string | null | undefined): string {
  const next = safeLocalPath(requested, '/');
  if (next === '/' || next === '/auth' || next.startsWith('/auth/') || next.startsWith('/auth?')) return SIGN_IN_PATH;
  return `${SIGN_IN_PATH}?next=${encodeURIComponent(next)}`;
}
