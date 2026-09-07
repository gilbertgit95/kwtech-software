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

/**
 * How long a WebSocket ticket is good for. SIXTY SECONDS.
 *
 * A ticket exists because the session lives in an httpOnly cookie the page
 * cannot read, and a browser opening a WebSocket has to put SOMETHING in
 * `connectionParams`. Handing over the access token would undo the whole
 * httpOnly design — any XSS could read a credential good for
 * `ACCESS_TOKEN_TTL`. So the browser asks the same-origin proxy for a ticket
 * instead, and the session never leaves the server.
 *
 * A minute is the window between "the page decided to connect" and "the socket
 * opened", with room for a slow network and a retry. Anything longer is a
 * credential sitting in client memory for no reason; anything shorter starts
 * failing on bad connections.
 *
 * What a stolen ticket is worth: ONE connection, opened within a minute, that
 * closes when the access token it was minted from would have expired. It
 * authenticates no HTTP request at all — `verifyAccess` refuses it on `typ`.
 */
export const WS_TICKET_TTL = 60;

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

export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 32;

/**
 * One username, one spelling — the same rule as email, for the same reason.
 *
 * `Gilbert95` and `gilbert95` must not be two accounts, and a case-sensitive
 * `@unique` would cheerfully allow both. The display name is where casing a
 * person cares about lives; a username is an identifier.
 */
export function normaliseUsername(username: string): string {
  return username.normalize('NFKC').trim().toLowerCase();
}

/**
 * No '@', ever.
 *
 * That single restriction is what lets ONE sign-in field accept either an
 * address or a username: the two namespaces cannot overlap, so an identifier
 * containing '@' is unambiguously an email and anything else is unambiguously a
 * username. Without it, someone could register the username `you@example.com`
 * and make every lookup ambiguous.
 */
export function isPlausibleUsername(username: string): boolean {
  if (username.length < MIN_USERNAME_LENGTH || username.length > MAX_USERNAME_LENGTH) return false;
  return /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(username);
}

/**
 * Which namespace an identifier belongs to. Structural, not a validity check —
 * `looksLikeEmail('nonsense@')` is true, and the lookup then simply finds
 * nothing, which is the correct outcome for a sign-in attempt.
 */
export function looksLikeEmail(identifier: string): boolean {
  return identifier.includes('@');
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

// ─── second factors ─────────────────────────────────────────────────────────
//
// The pure half of TOTP: which time step a moment falls in, how much clock
// drift is forgiven, and what a code may look like. The HMAC itself needs
// node:crypto and lives in server/totp.ts, so this file stays safe to bundle
// for a browser — a page that renders a countdown needs TOTP_STEP_SECONDS and
// must not pull crypto in to get it.

/** Seconds per code. 30 is what every authenticator app assumes. */
export const TOTP_STEP_SECONDS = 30;

/** RFC 6238 default, and what every app displays. */
export const TOTP_DIGITS = 6;

/**
 * How many steps either side of "now" are accepted — ±1, so ±30 seconds.
 *
 * Not zero: phone clocks drift, and a user typing the last digit as the code
 * rolls over would be told they are wrong when they were right, which trains
 * people to distrust the mechanism. Not larger either — every extra step
 * multiplies the number of codes valid at any instant, and with 10⁶ codes and a
 * lockout at MAX_FAILED_LOGINS the guessing odds are the whole security margin.
 */
export const TOTP_DRIFT_STEPS = 1;

/** 160 bits, matching HMAC-SHA1's block behaviour and RFC 4226's recommendation. */
export const TOTP_SECRET_BYTES = 20;

/**
 * Which time step a moment belongs to — the counter the code is derived from.
 *
 * Pure and exported so replay protection (`AuthMfaFactor.lastUsedStep`) is
 * checked against the same arithmetic that produced the code, rather than
 * against a second implementation that could round differently.
 */
export function totpStepAt(now: Date, stepSeconds: number = TOTP_STEP_SECONDS): number {
  return Math.floor(now.getTime() / 1000 / stepSeconds);
}

/** How many recovery codes a confirmation hands out. */
export const RECOVERY_CODE_COUNT = 10;

/** Bytes of entropy per recovery code — 80 bits, well beyond guessable. */
export const RECOVERY_CODE_BYTES = 10;

/**
 * One spelling for a code the user typed.
 *
 * People paste `123 456`, and authenticator apps and recovery-code lists both
 * display groups separated by spaces or hyphens. Rejecting those is refusing a
 * correct answer because of its whitespace.
 */
export function normaliseMfaCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * Structural check only — whether this is even the shape of a TOTP code.
 *
 * Its job is to keep a 900-character body out of the HMAC path, not to decide
 * anything: a wrong-shaped code and a wrong code are refused identically, since
 * the difference would tell a caller which of the two credentials they are
 * being asked for.
 */
export function isPlausibleTotpCode(code: string): boolean {
  return new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(code);
}

/** The same, for a recovery code: base32 alphabet, fixed length. */
export function isPlausibleRecoveryCode(code: string): boolean {
  return new RegExp(`^[A-Z2-7]{${Math.ceil((RECOVERY_CODE_BYTES * 8) / 5)}}$`).test(code);
}
