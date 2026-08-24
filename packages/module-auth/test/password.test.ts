import { hashPassword, verifyPassword } from '../src/server/password.js';

/**
 * scrypt is intentionally slow, so this suite is the slowest in the repo. That
 * is the property being tested as much as the correctness.
 */
jest.setTimeout(30_000);

describe('hashPassword', () => {
  it('round-trips', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery stapler', hash)).toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    // Without this, identical hashes reveal which users share a password.
    const [a, b] = await Promise.all([hashPassword('same password here'), hashPassword('same password here')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('same password here', b)).toBe(true);
  });

  it('is self-describing, so the algorithm can change without a forced reset', async () => {
    expect(await hashPassword('whatever goes here')).toMatch(/^scrypt\$N=16384,r=8,p=1\$[\w+/=]+\$[\w+/=]+$/);
  });

  it('normalises unicode, so a password typed on a different keyboard still verifies', async () => {
    // 'é' composed vs decomposed is the same password to the person typing it.
    const composed = 'café password long';
    const decomposed = 'café password long';
    expect(await verifyPassword(decomposed, await hashPassword(composed))).toBe(true);
  });
});

describe('verifyPassword refuses rather than throwing', () => {
  // A corrupt row must read as "wrong password" at the sign-in endpoint, never
  // as a 500 — which would tell an attacker the account exists and that
  // something about it is unusual.
  it.each([
    ['', 'empty'],
    ['not-a-hash', 'no delimiters'],
    ['bcrypt$N=1$salt$hash', 'unknown scheme'],
    ['scrypt$$salt$hash', 'no parameters'],
    ['scrypt$N=x,r=y,p=z$salt$hash', 'non-numeric parameters'],
    ['scrypt$N=16384,r=8,p=1$$', 'empty salt and hash'],
  ])('returns false for %p (%s)', async (stored) => {
    await expect(verifyPassword('anything at all', stored)).resolves.toBe(false);
  });

  it('returns false rather than crashing on absurd parameters', async () => {
    // N must be a power of two above 1; node throws otherwise, and that throw
    // must not reach the endpoint.
    await expect(verifyPassword('anything at all', 'scrypt$N=3,r=8,p=1$c2FsdA==$aGFzaA==')).resolves.toBe(false);
  });
});
