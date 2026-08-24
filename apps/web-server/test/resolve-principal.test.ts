import type { Principal } from '@kwtech/module-auth';
import { PRINCIPAL_KEY } from '@kwtech/module-auth/server';
import { resolvePrincipal } from '../src/auth/resolve-principal.js';

/**
 * The seam between authentication and authorisation.
 *
 * Small enough to read in one screen and consequential enough that every branch
 * is a security decision — which is exactly the profile of code that gets
 * written inline in a decorator and never tested again.
 */

const request = (principal?: Partial<Principal>) => ({
  [PRINCIPAL_KEY]: principal ? { userId: 'u1', sessionId: 's1', scope: 'full', expiresAt: 0, ...principal } : undefined,
});

describe('resolvePrincipal', () => {
  it('hands the user id across for a full session', () => {
    expect(resolvePrincipal(request({ userId: 'u42' }))).toEqual({ userId: 'u42' });
  });

  it('hands across ONLY the id', () => {
    // Anything else would be a second copy of a fact auth already owns — and
    // the organization in particular must come from the URL, not the token.
    expect(Object.keys(resolvePrincipal(request({})) ?? {})).toEqual(['userId']);
  });

  it('refuses a step-up token, so it grants nothing anywhere', () => {
    // A pwd_change token proves identity for one endpoint. If it resolved to a
    // permission context, every other endpoint would authorise its holder
    // normally and the restricted scope would be decorative.
    expect(resolvePrincipal(request({ scope: 'pwd_change' }))).toBeUndefined();
  });

  it.each([
    ['no principal on the request', {}],
    ['an undefined principal', request()],
    ['an undefined request', undefined],
    ['a null request', null],
    ['a request that is not an object', 'nonsense'],
  ])('returns undefined for %s', (_label, input) => {
    expect(resolvePrincipal(input)).toBeUndefined();
  });

  it('fails closed on a principal with an empty userId', () => {
    // Not reachable through the guard, which validates its claims. But this is
    // the last line before permissions answers, and an empty id would reach the
    // tables, match nothing and be denied — the same outcome, arrived at by
    // answering a question nobody asked.
    expect(resolvePrincipal(request({ userId: '' }))).toBeUndefined();
  });
});
