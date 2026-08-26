import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { TOTP_DIGITS, TOTP_DRIFT_STEPS, TOTP_SECRET_BYTES, TOTP_STEP_SECONDS, totpStepAt } from '../domain/policy.js';

/**
 * RFC 6238 time-based one-time passwords, and nothing else — no database, no
 * policy, no encryption. The secret arrives here already decrypted and leaves
 * again; storing it is secret-box.ts's job and deciding what to do with a
 * verdict is AuthService's.
 *
 * Written out rather than taken from a dependency. It is forty lines of HMAC
 * and a truncation, it is specified to the bit, and the RFC's own test vectors
 * pin it (see test/totp.test.ts) — which is a better argument for correctness
 * than a package's download count, on a path where a silent difference means
 * either "nobody can sign in" or "any code works".
 *
 * SHA-1, deliberately, despite being SHA-1: every authenticator app in
 * circulation assumes it for the `otpauth://` URI, and `algorithm=SHA256` is
 * quietly ignored by enough of them that enrolment would appear to work and
 * then reject every code. The collision weaknesses that retire SHA-1 elsewhere
 * do not apply to HMAC, and the value is 6 digits with a 30-second life.
 */

/** Base32, RFC 4648, no padding — the alphabet every authenticator app expects. */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function toBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  // The trailing partial group is left-aligned and zero-filled, per RFC 4648.
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** Returns null on anything outside the alphabet rather than guessing at it. */
export function fromBase32(encoded: string): Buffer | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of encoded.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index === -1) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh secret, base32-encoded because that is the form a QR code carries. */
export function generateTotpSecret(): string {
  return toBase32(randomBytes(TOTP_SECRET_BYTES));
}

/**
 * The code for one time step. Exported for the tests and for nothing else —
 * production only ever verifies.
 */
export function totpCodeAt(secretBase32: string, step: number, digits: number = TOTP_DIGITS): string | null {
  const key = fromBase32(secretBase32);
  if (!key || key.length === 0) return null;

  // The counter as a big-endian 64-bit integer. Written through a BigInt
  // because a step is seconds/30 and `<<` in JS is a 32-bit operation — the
  // naive version silently wraps and produces codes that verify against
  // nothing, starting in 2038 rather than in the test suite.
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));

  const digest = createHmac('sha1', key).update(counter).digest();
  // Dynamic truncation, RFC 4226 §5.3: the low nibble of the last byte picks a
  // four-byte window, and the high bit of it is masked off so the result is
  // positive on platforms that read the word as a signed integer.
  //
  // `readUInt32BE` rather than four shifted lookups — SHA-1 is 20 bytes and the
  // offset is at most 15, so the window is always in range, and reading it as
  // one word says that instead of asserting it four times.
  const offset = digest.readUInt8(digest.length - 1) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7f_ff_ff_ff;

  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

export interface TotpVerdict {
  ok: boolean;
  /** The step the code belonged to — what goes in `AuthMfaFactor.lastUsedStep`. */
  step: number | null;
  /**
   * True when the code was genuine but its step has already been spent.
   *
   * Distinguished from a plain failure for the OPERATOR's benefit only: a
   * replay is somebody presenting a code they observed, which is a different
   * event from a user fat-fingering a digit, and the log should be able to say
   * so. The caller is told the same thing either way.
   */
  replayed: boolean;
}

/**
 * Whether a code is currently valid for a secret, given what has already been
 * used.
 *
 * `lastUsedStep` is not optional and not an afterthought: a code stays valid
 * for its whole window, so without refusing steps at or below the last accepted
 * one, anyone who observes a code — over a shoulder, in a phishing proxy, in a
 * log — can present it again inside the same thirty seconds. Refusing the
 * *equal* case too is what makes it single-use rather than merely monotonic.
 *
 * Every candidate step is checked even after a match, so the work does not
 * depend on which step matched. The comparison itself is timingSafeEqual for
 * the same reason it is on passwords.
 */
export function verifyTotp(input: {
  secretBase32: string;
  code: string;
  now: Date;
  lastUsedStep: number | null;
  stepSeconds?: number;
  drift?: number;
}): TotpVerdict {
  const stepSeconds = input.stepSeconds ?? TOTP_STEP_SECONDS;
  const drift = input.drift ?? TOTP_DRIFT_STEPS;
  const current = totpStepAt(input.now, stepSeconds);

  let matched: number | null = null;
  for (let offset = -drift; offset <= drift; offset += 1) {
    const step = current + offset;
    if (step < 0) continue;
    const expected = totpCodeAt(input.secretBase32, step);
    if (expected && equals(expected, input.code) && matched === null) matched = step;
  }

  if (matched === null) return { ok: false, step: null, replayed: false };
  if (input.lastUsedStep !== null && matched <= input.lastUsedStep) {
    return { ok: false, step: matched, replayed: true };
  }
  return { ok: true, step: matched, replayed: false };
}

/**
 * The QR code's contents.
 *
 * `issuer` appears twice — as a label prefix and as a parameter — because apps
 * disagree about which one they read, and getting it wrong shows the user a
 * bare email address among a dozen other bare email addresses.
 */
export function otpauthUri(input: { secretBase32: string; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const params = new URLSearchParams({
    secret: input.secretBase32,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
