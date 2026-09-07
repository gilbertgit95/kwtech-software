import { safeSignOutDestination } from '../src/next/route-handlers.js';

/**
 * Signing out can be asked to land somewhere — `?next=` — so that "sign out and
 * sign in as the invited person" is one control rather than three steps the
 * user has to know about.
 *
 * That parameter is attacker-supplied on an endpoint anyone can reach, which
 * makes an OPEN REDIRECT the thing to get wrong: a link that signs you out and
 * then drops you on a convincing copy of the sign-in page is a working phishing
 * flow, and it arrives from a genuine URL on the real origin.
 */
describe('where sign-out lands', () => {
  it('honours a path on this origin', () => {
    expect(safeSignOutDestination('/auth/signin?next=%2Finvitations%2Faccept')).toBe(
      '/auth/signin?next=%2Finvitations%2Faccept',
    );
  });

  it.each([
    ['nothing asked for', null],
    ['an empty value', ''],
    ['an absolute URL', 'https://evil.example/signin'],
    ['a protocol-relative URL — a different HOST, and it looks like a path', '//evil.example/signin'],
    ['a backslash some browsers normalise to a slash', '/\\evil.example'],
    ['a bare word, which resolves relative to the current path', 'auth/signin'],
    ['a newline, which is header injection rather than a path', '/ok\nLocation: https://evil.example'],
  ])('falls back for %s', (_case, next) => {
    /*
     * Falls back rather than refusing: by the time this runs the session is
     * already gone, and failing the sign-out over a malformed query parameter
     * would leave somebody signed in who asked not to be.
     */
    expect(safeSignOutDestination(next)).toBe('/auth/signin');
  });
});
