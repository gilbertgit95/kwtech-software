import {
  checkPassword,
  expiryFrom,
  isExpired,
  isLockedOut,
  isPlausibleEmail,
  isPlausibleUsername,
  LOCKOUT_MS,
  looksLikeEmail,
  MAX_FAILED_LOGINS,
  MIN_PASSWORD_LENGTH,
  nextLockoutState,
  normaliseEmail,
  normaliseUsername,
} from '../src/domain/policy.js';

describe('normaliseEmail', () => {
  it('folds case and trims, so one address has one spelling', () => {
    // @unique on the raw string would happily accept both, which is two
    // accounts one person cannot tell apart.
    expect(normaliseEmail('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it('normalises unicode, so visually identical addresses collide as they should', () => {
    // NFKC: a full-width character and its ASCII twin must not be two accounts.
    expect(normaliseEmail('ＡＤＡ@example.com')).toBe('ada@example.com');
  });

  it('does NOT strip dots or +tags — whether they are the same person is the provider’s business', () => {
    // Guessing wrong here merges two real accounts, which is unrecoverable.
    expect(normaliseEmail('a.b+work@gmail.com')).toBe('a.b+work@gmail.com');
  });

  it('is idempotent', () => {
    const once = normaliseEmail('Ada@Example.com');
    expect(normaliseEmail(once)).toBe(once);
  });
});

describe('isPlausibleEmail', () => {
  it.each(['ada@example.com', 'a+b@sub.example.co.uk'])('accepts %p', (email) => {
    expect(isPlausibleEmail(email)).toBe(true);
  });

  it.each(['', 'ada', 'ada@', '@example.com', 'ada@example', 'a b@example.com'])('rejects %p', (email) => {
    expect(isPlausibleEmail(email)).toBe(false);
  });
});

describe('checkPassword', () => {
  it('accepts a long passphrase', () => {
    expect(checkPassword('correct horse battery staple')).toEqual({ ok: true });
  });

  it('rejects anything under the minimum', () => {
    expect(checkPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toEqual({ ok: false, reason: 'too_short' });
  });

  it('accepts exactly the minimum', () => {
    expect(checkPassword('a'.repeat(MIN_PASSWORD_LENGTH)).ok).toBe(true);
  });

  it('rejects a long-but-obvious password that length alone would pass', () => {
    expect(checkPassword('password1234')).toEqual({ ok: false, reason: 'too_common' });
  });

  it('applies the denylist case-insensitively', () => {
    expect(checkPassword('Password1234').ok).toBe(false);
  });

  it('measures the NORMALISED length, so composed characters are not counted twice', () => {
    // 'é' as e + combining acute is one character to a user and two to .length.
    const composed = 'é'.repeat(MIN_PASSWORD_LENGTH - 1);
    expect(checkPassword(composed)).toEqual({ ok: false, reason: 'too_short' });
  });

  it('has no character-class rule', () => {
    // Composition rules push people to 'Password1!' — short, predictable, and
    // worse than a passphrase such a rule would reject.
    expect(checkPassword('all lowercase words here').ok).toBe(true);
  });
});

describe('nextLockoutState', () => {
  const now = new Date('2026-08-25T12:00:00Z');

  it('counts a failure without locking, below the threshold', () => {
    expect(nextLockoutState(0, now)).toEqual({ failedLoginCount: 1, lockedUntil: null });
  });

  it('locks on the threshold failure', () => {
    const state = nextLockoutState(MAX_FAILED_LOGINS - 1, now);
    expect(state.lockedUntil).toEqual(new Date(now.getTime() + LOCKOUT_MS));
  });

  it('resets the counter when it locks, so further attempts cannot extend the lockout', () => {
    // Counting past the threshold would let an attacker keep a victim locked
    // out indefinitely by continuing to guess.
    expect(nextLockoutState(MAX_FAILED_LOGINS - 1, now).failedLoginCount).toBe(0);
  });
});

describe('isLockedOut', () => {
  const now = new Date('2026-08-25T12:00:00Z');

  it('is false when nothing is set', () => {
    expect(isLockedOut(null, now)).toBe(false);
    expect(isLockedOut(undefined, now)).toBe(false);
  });

  it('is true inside the window and false once it passes', () => {
    expect(isLockedOut(new Date(now.getTime() + 1000), now)).toBe(true);
    expect(isLockedOut(new Date(now.getTime() - 1000), now)).toBe(false);
  });

  it('is false exactly at the boundary — the lock has run out', () => {
    expect(isLockedOut(new Date(now.getTime()), now)).toBe(false);
  });
});

describe('isExpired / expiryFrom', () => {
  const now = new Date('2026-08-25T12:00:00Z');

  it('treats the exact expiry moment as expired', () => {
    // The safe direction: a token whose second has arrived is spent.
    expect(isExpired(now, now)).toBe(true);
  });

  it('round-trips a TTL', () => {
    expect(isExpired(expiryFrom(now, 60), now)).toBe(false);
    expect(isExpired(expiryFrom(now, 60), new Date(now.getTime() + 60_001))).toBe(true);
  });
});

describe('normaliseUsername', () => {
  it('folds case, so Gilbert95 and gilbert95 are one account', () => {
    expect(normaliseUsername('  Gilbert95 ')).toBe('gilbert95');
  });

  it('is idempotent', () => {
    expect(normaliseUsername(normaliseUsername('Gilbert95'))).toBe('gilbert95');
  });
});

describe('isPlausibleUsername', () => {
  it.each(['gilbert95', 'a_b', 'a.b-c', 'abc'])('accepts %p', (name) => {
    expect(isPlausibleUsername(name)).toBe(true);
  });

  it.each([
    ['ab', 'too short'],
    ['a'.repeat(33), 'too long'],
    ['_leading', 'starts with a separator'],
    ['trailing.', 'ends with a separator'],
    ['has space', 'contains a space'],
    ['Gilbert95', 'not normalised'],
  ])('rejects %p (%s)', (name) => {
    expect(isPlausibleUsername(name)).toBe(false);
  });

  it('rejects anything containing @, which is what keeps the two namespaces apart', () => {
    // Without this, registering the username `you@example.com` would make every
    // sign-in lookup ambiguous.
    expect(isPlausibleUsername('you@example.com')).toBe(false);
  });
});

describe('looksLikeEmail', () => {
  it('routes an identifier to the right namespace', () => {
    expect(looksLikeEmail('ada@example.com')).toBe(true);
    expect(looksLikeEmail('gilbert95')).toBe(false);
  });

  it('is structural, not a validity check — a bad address still routes as one', () => {
    // It then finds nothing, which is the correct outcome for a sign-in attempt.
    expect(looksLikeEmail('nonsense@')).toBe(true);
  });
});
