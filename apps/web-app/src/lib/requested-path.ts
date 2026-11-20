/**
 * The address a page was asked for, handed from the proxy to the shells
 * (#181).
 *
 * A server component is not told its own URL, and the shells need it for one
 * thing: sending a signed-out reader to sign in and BACK. Without it every
 * link opened signed out ended on the home page after signing in.
 *
 * ⚠ The proxy always SETS this header, so a value the browser sent never
 * survives to the shell; and the shell only ever uses it through
 * `signInPathFor`, which keeps nothing but a path on this origin. The header
 * decides where somebody lands after proving who they are, never what they
 * may see.
 */
export const REQUESTED_PATH_HEADER = 'x-kwtech-requested-path';

/** The path and query that were asked for, from a request URL. Before any phone rewrite: the address bar's. */
export function requestedPathOf(url: { pathname: string; search: string }): string {
  return `${url.pathname}${url.search}`;
}
