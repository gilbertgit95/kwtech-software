import type { SessionView } from '../types.js';

/**
 * A queuing session, and the code that admits a TV to it.
 *
 * Someone holding `queue:start` presses Start queuing and the system generates
 * a display code. A TV opens the public URL, somebody types the code, and the
 * TV shows the queue until somebody holding `queue:stop` presses Stop. The next
 * Start generates a new code. So the daily routine of starting and stopping is
 * what rotates the credential, and rotation stops being a chore nobody does.
 */

export type SessionRefusal = 'not_started' | 'already_running';

/** Open means started and not stopped. */
export function isSessionOpen(session: Pick<SessionView, 'stoppedAt'> | null | undefined): boolean {
  return session != null && session.stoppedAt === null;
}

/**
 * ⚠ THE SESSION GATES THE QUEUE, NOT JUST THE TV. With no open session, Call
 * next, Recall and Call number… are refused with "Queuing has not started".
 */
export function checkCallingAllowed(session: Pick<SessionView, 'stoppedAt'> | null | undefined): SessionRefusal | null {
  return isSessionOpen(session) ? null : 'not_started';
}

/**
 * Start is refused while a session is open. The database refuses it too —
 * `openWorkspaceId` is unique — and this is the answer the console can show
 * before a unique violation has to be translated into one.
 */
export function checkCanStart(openSession: Pick<SessionView, 'stoppedAt'> | null | undefined): SessionRefusal | null {
  return isSessionOpen(openSession) ? 'already_running' : null;
}

/**
 * The fields Stop writes.
 *
 * ⚠ THE CODE IS CLEARED, so a stopped session holds no live secret, and
 * `openWorkspaceId` goes to null, which is what lets the next Start insert.
 * Seats are NOT in here: they persist across sessions.
 */
export function stoppedSessionFields(actorId: string, now: Date) {
  return { openWorkspaceId: null, displayCode: null, stoppedById: actorId, stoppedAt: now } as const;
}

// ── the display code ──────────────────────────────────────────────────────────

/**
 * Crockford base32: digits and letters minus I, L, O and U, the ones people
 * misread. Exactly 32 characters, so one random byte masked to five bits picks
 * one without bias.
 */
export const DISPLAY_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Eight characters: 32⁸ ≈ 2⁴⁰ codes. Short enough to type with a TV remote.
 *
 * ⚠ Only safe because guessing happens over throttled HTTP, never at the
 * socket: the exchange sits behind the tight `credential` bucket, and a session
 * stops accepting its code after `MAX_FAILED_CODE_ATTEMPTS` wrong ones.
 */
export const DISPLAY_CODE_LENGTH = 8;

/**
 * Wrong codes a session tolerates before it stops accepting its code.
 *
 * Why this AND a per-IP limit: per-IP alone is defeated by a botnet, and this
 * alone lets somebody lock the TVs out by guessing wrong on purpose. The console
 * then says "Too many wrong codes — stop and restart to get a new one", which
 * makes that attack visible instead of mysterious.
 */
export const MAX_FAILED_CODE_ATTEMPTS = 20;

/**
 * A fresh code, normalised (no dash).
 *
 * `randomBytes` is injected, so this stays pure and a test can pin it. The
 * server passes `node:crypto`'s `randomBytes`, never `Math.random`.
 */
export function generateDisplayCode(randomBytes: (length: number) => Uint8Array): string {
  const bytes = randomBytes(DISPLAY_CODE_LENGTH);
  if (bytes.length < DISPLAY_CODE_LENGTH) {
    throw new Error(`A display code needs ${DISPLAY_CODE_LENGTH} random bytes; got ${bytes.length}`);
  }
  let code = '';
  for (const byte of bytes.subarray(0, DISPLAY_CODE_LENGTH)) {
    code += DISPLAY_CODE_ALPHABET.charAt(byte & 0b11111);
  }
  return code;
}

/** `K7QM4XHT` → `K7QM-4XHT`, as the console shows it. */
export function formatDisplayCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * What somebody typed, as a normalised code — or null if it cannot be one.
 *
 * Case-insensitive, and dashes and spaces are ignored. Crockford's own decoding
 * rule reads O as 0 and I or L as 1, since those are the misreadings the
 * alphabet exists to absorb. U is simply not a character of a code.
 */
export function normaliseDisplayCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[\s-]/gu, '').replace(/O/gu, '0').replace(/[IL]/gu, '1');
  if (cleaned.length !== DISPLAY_CODE_LENGTH) return null;
  return [...cleaned].every((char) => DISPLAY_CODE_ALPHABET.includes(char)) ? cleaned : null;
}

export type CodeExchangeRefusal = 'not_running' | 'locked' | 'wrong_code' | 'display_cap';

/**
 * ⚠ THE ONLY THING A TV IS EVER TOLD, whatever the reason.
 *
 * Organization keys are human-readable company names. A page that answered "no
 * such organization" differently from "wrong code" would let anybody enumerate
 * customers by guessing names. So every failure — unknown organization or
 * workspace, no session running, wrong code, too many attempts, display cap —
 * returns this, with the same status. The console gets the specific reason.
 */
export const DISPLAY_CODE_REFUSAL_MESSAGE = 'That code is not valid here right now';

export type CodeExchangeOutcome =
  | { accepted: true }
  | {
      accepted: false;
      reason: CodeExchangeRefusal;
      /** Whether to increment `failedCodeAttempts`. Only a wrong code counts. */
      countsAsFailure: boolean;
    };

/**
 * Whether a typed code admits a display to this session.
 *
 * The session is the workspace's OPEN one, or null — an unknown organization or
 * workspace reaches here as null too, so it cannot answer differently.
 *
 * ⚠ ORDER MATTERS:
 *   1. not running — nothing to compare against, and nothing to count on.
 *   2. locked — checked BEFORE comparing, so a locked session does not go on
 *      confirming which code is right.
 *   3. wrong code — the only outcome that counts as a failed attempt.
 *   4. display cap — a RIGHT code on a full session. Not a failure: the person
 *      typing it was told the code.
 *
 * The comparison is ordinary string equality. The exchange is rate-limited per
 * IP and per session, which bounds a timing probe far below what an 8-character
 * compare could leak.
 */
export function evaluateCodeExchange(input: {
  session: Pick<SessionView, 'stoppedAt' | 'displayCode' | 'failedCodeAttempts' | 'maxDisplays'> | null | undefined;
  typed: string;
  activeDisplays: number;
}): CodeExchangeOutcome {
  const { session, typed, activeDisplays } = input;

  if (!session || !isSessionOpen(session) || !session.displayCode) {
    return { accepted: false, reason: 'not_running', countsAsFailure: false };
  }
  if (session.failedCodeAttempts >= MAX_FAILED_CODE_ATTEMPTS) {
    return { accepted: false, reason: 'locked', countsAsFailure: false };
  }
  if (normaliseDisplayCode(typed) !== session.displayCode) {
    return { accepted: false, reason: 'wrong_code', countsAsFailure: true };
  }
  if (activeDisplays >= session.maxDisplays) {
    return { accepted: false, reason: 'display_cap', countsAsFailure: false };
  }
  return { accepted: true };
}

// ── the display pass ──────────────────────────────────────────────────────────

/** 256 random bits. A value that cannot be guessed, so the socket handshake needs no attempt limiter. */
export const DISPLAY_PASS_BYTES = 32;

/** 32 bytes in base64url, unpadded, is 43 characters. */
const PASS_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Whether a value could be a pass, checked before hashing it and reading the
 * database. A handshake presenting anything else is refused without a query.
 */
export function isDisplayPassShaped(value: unknown): value is string {
  return typeof value === 'string' && PASS_SHAPE.test(value);
}

/**
 * The `connectionParams` field a TV puts its pass in. Here, in the domain, because
 * the server's handshake hook and the browser's socket must spell it the same —
 * and the browser must never import server code to learn it.
 */
export const DISPLAY_PASS_PARAM = 'displayPass';
