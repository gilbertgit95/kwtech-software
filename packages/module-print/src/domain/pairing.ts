/**
 * Pairing a computer: a short code typed once, exchanged for a long secret the
 * computer keeps (docs/PRINT-STUDIO-PLAN.md §10, "Access").
 *
 * The same two steps as the queue's TV display, and for the same reason:
 * guessing happens over HTTP against a rate limit, and the socket only ever
 * sees a secret that cannot be guessed. What is new here is that the secret
 * OUTLIVES A SESSION, so it must be revocable — see `PrintAgent.revokedAt`.
 *
 * Pure: nothing here draws a random number. The server passes the bytes in.
 */

/** No 0/O and no 1/I/L, which are misread off one screen and mistyped on another. 31 symbols. */
export const PRINT_PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Ten symbols of thirty-one: about 49 bits.
 *
 * ⚠ LONGER THAN THE QUEUE'S DISPLAY CODE ON PURPOSE. That code is checked
 * against ONE session a person named (organization, workspace), with a failure
 * count on it. This one is looked up by itself, across every workspace, so
 * there is no row to count failures on: its length and the credential rate
 * limit are the whole defence. At ten tries a minute per address, 2^49 is out
 * of reach inside the ten minutes a code lives.
 */
export const PRINT_PAIRING_CODE_LENGTH = 10;

/** How long a code may be typed after it is made. Long enough to walk to the other computer. */
export const PRINT_PAIRING_TTL_MINUTES = 10;

/** More than any code however it is spaced. Anything longer is refused unread. */
export const PRINT_PAIRING_TYPED_MAX = 32;

/**
 * A code from random bytes, one symbol per byte.
 *
 * ⚠ `byte % 31` is very slightly biased (256 is not a multiple of 31). It
 * costs a fraction of a bit over ten symbols and is not worth a rejection loop
 * for a code that lives ten minutes.
 */
export function pairingCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length < PRINT_PAIRING_CODE_LENGTH) throw new Error('Not enough random bytes for a pairing code');
  let code = '';
  for (let index = 0; index < PRINT_PAIRING_CODE_LENGTH; index += 1) {
    code += PRINT_PAIRING_ALPHABET[(bytes[index] as number) % PRINT_PAIRING_ALPHABET.length];
  }
  return code;
}

/** `ABCDE-FGHJK`: two groups, easier to read aloud and to type. */
export function formatPairingCode(code: string): string {
  const half = PRINT_PAIRING_CODE_LENGTH / 2;
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

/**
 * What was typed, as the code it stands for, or null when it cannot be one.
 *
 * Spaces and dashes are dropped and case is ignored, so a code read off one
 * screen and typed on another matches however it was grouped. Anything else
 * that is not in the alphabet is a refusal, decided before any query.
 */
export function normalisePairingCode(typed: unknown): string | null {
  if (typeof typed !== 'string' || typed.length > PRINT_PAIRING_TYPED_MAX) return null;
  const code = typed.replace(/[\s-]/g, '').toUpperCase();
  if (code.length !== PRINT_PAIRING_CODE_LENGTH) return null;
  for (const symbol of code) {
    if (!PRINT_PAIRING_ALPHABET.includes(symbol)) return null;
  }
  return code;
}

/** The facts a pairing decision needs. */
export interface PairingCodeFacts {
  expiresAt: Date;
  usedAt: Date | null;
}

/** Whether a code may still pair a computer. Absent, used and expired are all "no". */
export function isPairingCodeUsable(code: PairingCodeFacts | null | undefined, now: Date): code is PairingCodeFacts {
  return !!code && code.usedAt === null && code.expiresAt.getTime() > now.getTime();
}

export function pairingExpiry(now: Date): Date {
  return new Date(now.getTime() + PRINT_PAIRING_TTL_MINUTES * 60_000);
}

// ── the secret ───────────────────────────────────────────────────────────────

/** 256 bits. Not guessable, so the socket handshake that takes it needs no attempt limiter. */
export const PRINT_AGENT_SECRET_BYTES = 32;

/**
 * The key the agent presents its secret under in the socket's
 * `connectionParams`. ⚠ The app composes anonymous admission BY THIS KEY: a
 * socket carrying it is offered to this module and to no other.
 */
export const PRINT_AGENT_SECRET_PARAM = 'printAgentSecret';

/** 32 bytes as unpadded base64url. */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Whether a value could be an agent's secret. Refuses everything else before any query. */
export function isAgentSecretShaped(value: unknown): value is string {
  return typeof value === 'string' && SECRET_PATTERN.test(value);
}
