/**
 * The decisions, with no I/O and no crypto: what counts as the same email, when
 * an account is locked, how long a thing lives, and what makes a password
 * acceptable.
 *
 * Pure on purpose. These are the rules most likely to be argued about and
 * changed, and keeping them out of the service means they can be read, tested
 * and adjusted without a database or a Nest container in the way.
 */

/**
 * Seconds. How long a signed-in session lasts — "stay signed in for a week".
 *
 * This is the number the app's AUTH_SESSION_TTL env var overrides, and this
 * value is the fallback when it is unset or unparseable. It is the REFRESH
 * token's lifetime, because that is what the session row is addressed by and
 * therefore what actually decides when someone is signed out.
 */
export const SESSION_TTL = 7 * 24 * 60 * 60;

/** @deprecated Read as SESSION_TTL; kept so an older import does not silently change meaning. */
export const REFRESH_TOKEN_TTL = SESSION_TTL;

/**
 * Seconds. Deliberately much shorter than the session, and NOT one week.
 *
 * The access token is verified from its signature alone — no database read, by
 * design (see AuthSession in prisma/auth.prisma), which is what keeps
 * authentication off the hot path. The cost of that is the only thing this
 * number controls: **a revoked session stays usable until its current access
 * token expires.** At fifteen minutes that window is a nuisance; at a week it
 * would mean "sign out everywhere" and "suspend this account" do nothing for
 * seven days, including after a password reset.
 *
 * So the two are separate knobs on purpose: the session lasts a week, and the
 * client silently renews against it every fifteen minutes. Overridable with
 * AUTH_ACCESS_TOKEN_TTL for an app that has measured the trade and wants it
 * different.
 */
export const ACCESS_TOKEN_TTL = 15 * 60;

/**
 * Seconds. Deliberately short — a reset link sits in an inbox, which is the
 * least trustworthy place a credential ever waits.
 */
export const PASSWORD_RESET_TTL = 60 * 60;

/** Failures before the account locks. Per account; the per-IP limit is the app's throttler. */
export const MAX_FAILED_LOGINS = 10;

/** Milliseconds an account stays locked once it trips. */
export const LOCKOUT_MS = 15 * 60 * 1000;

export const MIN_PASSWORD_LENGTH = 12;

/**
 * One address, one spelling.
 *
 * Lower-cased and NFKC-normalised before it is ever stored or looked up.
 * `@unique` on the raw string would happily accept `Ada@x.com` alongside
 * `ada@x.com`, which is two accounts one person cannot tell apart — and a
 * password reset that silently fixes the wrong one.
 *
 * Only the whole string is folded; the local part is NOT stripped of dots or
 * `+tags`. Whether `a.b@gmail.com` and `ab@gmail.com` are one person is a
 * provider-specific question, and guessing it wrong merges two real accounts.
 */
export function normaliseEmail(email: string): string {
  return email.normalize('NFKC').trim().toLowerCase();
}

/** Cheap structural check. Delivery is the only real proof an address exists. */
export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email);
}

export interface PasswordComplaint {
  ok: boolean;
  reason?: 'too_short' | 'too_common';
}

/**
 * Length first, and length mostly.
 *
 * No character-class rules: they push people towards `Password1!` — short,
 * predictable, and worse than a long passphrase that a composition rule would
 * have rejected. A denylist of the obvious catches what length alone cannot.
 */
export function checkPassword(plain: string): PasswordComplaint {
  const normalised = plain.normalize('NFKC');
  if (normalised.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'too_short' };
  if (COMMON.has(normalised.toLowerCase())) return { ok: false, reason: 'too_common' };
  return { ok: true };
}

const COMMON = new Set([
  'password',
  'password123',
  'passw0rd',
  'password1234',
  '123456789012',
  '1234567890123',
  'qwertyuiop',
  'qwertyuiop123',
  'administrator',
  'letmeinplease',
  'iloveyou1234',
]);

/** Whether the account is inside a lockout window, at a given moment. */
export function isLockedOut(lockedUntil: Date | null | undefined, now: Date): boolean {
  return lockedUntil !== null && lockedUntil !== undefined && lockedUntil.getTime() > now.getTime();
}

/**
 * The account's brute-force state after one more failure.
 *
 * Returns the row to write rather than writing it, so the rule is testable
 * without a database and identical wherever it is applied.
 */
export function nextLockoutState(
  failedLoginCount: number,
  now: Date,
): { failedLoginCount: number; lockedUntil: Date | null } {
  const failures = failedLoginCount + 1;
  // Counting past the threshold would extend the lockout on every further
  // attempt, which lets an attacker keep a victim locked out indefinitely.
  if (failures < MAX_FAILED_LOGINS) return { failedLoginCount: failures, lockedUntil: null };
  return { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MS) };
}

/** Expiry, in one place, so "expired" means the same thing to sessions and reset tokens. */
export function isExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function expiryFrom(now: Date, ttlSeconds: number): Date {
  return new Date(now.getTime() + ttlSeconds * 1000);
}
