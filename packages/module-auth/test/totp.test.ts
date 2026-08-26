import { TOTP_STEP_SECONDS, totpStepAt } from '../src/domain/policy.js';
import { fromBase32, generateTotpSecret, otpauthUri, toBase32, totpCodeAt, verifyTotp } from '../src/server/totp.js';

/**
 * The RFC's own vectors, plus the two properties the RFC does not cover and
 * this module depends on: replay refusal and drift.
 *
 * These vectors are the reason it was reasonable to write the algorithm out
 * rather than take a dependency — a silent difference here means either
 * "nobody can sign in" or "any code works", and neither shows up in a smoke
 * test.
 */

/** RFC 6238 Appendix B: the ASCII string "12345678901234567890". */
const RFC_SECRET = toBase32(Buffer.from('12345678901234567890', 'ascii'));

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    for (const length of [1, 2, 3, 4, 5, 10, 20]) {
      const bytes = Buffer.from(Array.from({ length }, (_, index) => (index * 37 + 11) % 256));
      expect(fromBase32(toBase32(bytes))).toEqual(bytes);
    }
  });

  it('uses the RFC 4648 alphabet, which excludes 0/1/8/9', () => {
    expect(toBase32(Buffer.from([0]))).toBe('AA');
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]+$/);
  });

  it('returns null rather than guessing at a character outside the alphabet', () => {
    // '0' and 'O' are the classic confusion, and silently mapping one to the
    // other would accept a mistyped secret and then reject every code it
    // produces — a failure that looks like a broken authenticator app.
    expect(fromBase32('AAAA0')).toBeNull();
    expect(fromBase32('nope!')).toBeNull();
  });
});

describe('totpCodeAt — RFC 6238 Appendix B', () => {
  // The published vectors are 8-digit; the 6-digit code every app shows is the
  // same number truncated, which is exactly what a shorter `digits` produces.
  it.each([
    [59, '94287082'],
    [1_111_111_109, '07081804'],
    [1_111_111_111, '14050471'],
    [1_234_567_890, '89005924'],
    [2_000_000_000, '69279037'],
    [20_000_000_000, '65353130'],
  ])('matches the vector at T=%i', (seconds, expected) => {
    const step = Math.floor(seconds / TOTP_STEP_SECONDS);
    expect(totpCodeAt(RFC_SECRET, step, 8)).toBe(expected);
    expect(totpCodeAt(RFC_SECRET, step, 6)).toBe(expected.slice(-6));
  });

  it('survives a step beyond 2³² — the counter is 64-bit', () => {
    // A `<<`-based counter silently wraps here. Nothing in a test suite run in
    // 2026 would notice; the first user would, in 2038.
    expect(totpCodeAt(RFC_SECRET, Math.floor(20_000_000_000 / TOTP_STEP_SECONDS), 8)).toBe('65353130');
  });

  it('returns null for a secret that is not base32', () => {
    expect(totpCodeAt('not base32!', 1)).toBeNull();
  });
});

describe('verifyTotp', () => {
  const now = new Date(1_700_000_000_000);
  const step = totpStepAt(now);
  const codeNow = totpCodeAt(RFC_SECRET, step) as string;

  it('accepts the current code', () => {
    expect(verifyTotp({ secretBase32: RFC_SECRET, code: codeNow, now, lastUsedStep: null })).toMatchObject({
      ok: true,
      step,
    });
  });

  it('forgives one step of drift either way', () => {
    // Phone clocks drift, and a user typing the last digit as the code rolls
    // over is right, not wrong.
    for (const offset of [-1, 1]) {
      const code = totpCodeAt(RFC_SECRET, step + offset) as string;
      expect(verifyTotp({ secretBase32: RFC_SECRET, code, now, lastUsedStep: null }).ok).toBe(true);
    }
  });

  it('refuses two steps of drift', () => {
    // Every extra step multiplies the codes valid at any instant, and with six
    // digits that margin is the whole security of the factor.
    const code = totpCodeAt(RFC_SECRET, step + 2) as string;
    expect(verifyTotp({ secretBase32: RFC_SECRET, code, now, lastUsedStep: null }).ok).toBe(false);
  });

  it('REFUSES A CODE WHOSE STEP WAS ALREADY SPENT, and says it was a replay', () => {
    // The property `lastUsedStep` exists for: a code stays valid for its whole
    // window, so an observed code — over a shoulder, in a phishing proxy, in a
    // log — could otherwise be presented again inside the same thirty seconds.
    const verdict = verifyTotp({ secretBase32: RFC_SECRET, code: codeNow, now, lastUsedStep: step });
    expect(verdict).toMatchObject({ ok: false, replayed: true, step });
  });

  it('refuses a code from a step BELOW the last used one', () => {
    // Single-use, not merely monotonic: the drift window means an older step
    // can still produce a currently-valid code.
    const older = totpCodeAt(RFC_SECRET, step - 1) as string;
    expect(verifyTotp({ secretBase32: RFC_SECRET, code: older, now, lastUsedStep: step }).ok).toBe(false);
  });

  it('reports a wrong code as wrong, not as a replay', () => {
    // The distinction is for the operator's log: a replay is someone
    // presenting a code they observed, which is a different event from a user
    // fat-fingering a digit.
    expect(verifyTotp({ secretBase32: RFC_SECRET, code: '000000', now, lastUsedStep: step + 5 })).toMatchObject({
      ok: false,
      replayed: false,
    });
  });
});

describe('otpauthUri', () => {
  it('names the issuer twice, because apps disagree about which one they read', () => {
    const uri = otpauthUri({ secretBase32: 'ABCD', account: 'ada@example.com', issuer: 'KWTech' });
    expect(uri).toMatch(/^otpauth:\/\/totp\/KWTech:ada%40example\.com\?/);
    expect(uri).toContain('issuer=KWTech');
  });

  it('declares SHA1, 6 digits and a 30-second period explicitly', () => {
    // Left implicit, a minority of apps assume something else and every code
    // they generate is rejected — after enrolment appears to have worked.
    const uri = otpauthUri({ secretBase32: 'ABCD', account: 'ada', issuer: 'KWTech' });
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});
