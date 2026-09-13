import {
  checkCallingAllowed,
  checkCanStart,
  DISPLAY_CODE_ALPHABET,
  DISPLAY_CODE_LENGTH,
  evaluateCodeExchange,
  formatDisplayCode,
  generateDisplayCode,
  isDisplayPassShaped,
  MAX_FAILED_CODE_ATTEMPTS,
  normaliseDisplayCode,
  stoppedSessionFields,
} from '../src/domain/session.js';

const open = { stoppedAt: null };
const stopped = { stoppedAt: new Date() };

describe('the session gates the queue', () => {
  it('⚠ refuses calling with no open session — "Queuing has not started"', () => {
    expect(checkCallingAllowed(null)).toBe('not_started');
    expect(checkCallingAllowed(stopped)).toBe('not_started');
    expect(checkCallingAllowed(open)).toBeNull();
  });

  it('refuses Start while a session is open', () => {
    expect(checkCanStart(open)).toBe('already_running');
    expect(checkCanStart(stopped)).toBeNull();
    expect(checkCanStart(null)).toBeNull();
  });

  it('⚠ clears the code and frees the workspace when it stops', () => {
    const now = new Date('2026-09-13T17:00:00Z');
    expect(stoppedSessionFields('boss', now)).toEqual({
      openWorkspaceId: null,
      displayCode: null,
      stoppedById: 'boss',
      stoppedAt: now,
    });
  });
});

describe('the display code', () => {
  it('uses Crockford base32: 32 characters, none of I, L, O or U', () => {
    expect(DISPLAY_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(DISPLAY_CODE_ALPHABET).size).toBe(32);
    expect(DISPLAY_CODE_ALPHABET).not.toMatch(/[ILOU]/);
  });

  it('is eight characters drawn from the alphabet, by the random source it is given', () => {
    const code = generateDisplayCode(() => Uint8Array.from([0, 1, 2, 3, 30, 31, 32, 255]));
    expect(code).toBe('0123YZ0Z');
    expect(code).toHaveLength(DISPLAY_CODE_LENGTH);
  });

  it('refuses a random source that returns too few bytes, rather than padding it', () => {
    expect(() => generateDisplayCode(() => new Uint8Array(4))).toThrow(/8 random bytes/);
  });

  it('is shown with a dash in the middle', () => {
    expect(formatDisplayCode('K7QM4XHT')).toBe('K7QM-4XHT');
  });

  it.each([
    ['K7QM-4XHT', 'K7QM4XHT'],
    ['k7qm4xht', 'K7QM4XHT'],
    [' k7qm 4xht ', 'K7QM4XHT'],
    // Crockford's decoding rule: the misreadings the alphabet exists to absorb.
    ['K7QM-4XHO', 'K7QM4XH0'],
    ['I7QM-4XHL', '17QM4XH1'],
  ])('normalises %j to %j', (typed, expected) => {
    expect(normaliseDisplayCode(typed)).toBe(expected);
  });

  it.each([['K7QM-4XH'], ['K7QM-4XHTT'], ['K7QM-4XHU'], ['K7QM-4XH!'], ['']])('refuses %j', (typed) => {
    expect(normaliseDisplayCode(typed)).toBeNull();
  });
});

describe('evaluateCodeExchange', () => {
  const session = { stoppedAt: null, displayCode: 'K7QM4XHT', failedCodeAttempts: 0, maxDisplays: 5 };

  it('accepts the right code, however it was typed', () => {
    expect(evaluateCodeExchange({ session, typed: 'k7qm-4xht', activeDisplays: 0 })).toEqual({ accepted: true });
  });

  it.each([
    ['no session (or no such organization or workspace)', null],
    ['a stopped session', { ...session, stoppedAt: new Date() }],
    ['a session whose code was cleared', { ...session, displayCode: null }],
  ])('refuses %s as not running, and counts nothing', (_label, candidate) => {
    expect(evaluateCodeExchange({ session: candidate, typed: 'K7QM4XHT', activeDisplays: 0 })).toEqual({
      accepted: false,
      reason: 'not_running',
      countsAsFailure: false,
    });
  });

  it('counts a wrong code as a failed attempt', () => {
    expect(evaluateCodeExchange({ session, typed: 'AAAA-AAAA', activeDisplays: 0 })).toEqual({
      accepted: false,
      reason: 'wrong_code',
      countsAsFailure: true,
    });
  });

  it('counts something that cannot be a code as a wrong one', () => {
    expect(evaluateCodeExchange({ session, typed: 'hello', activeDisplays: 0 })).toMatchObject({
      reason: 'wrong_code',
      countsAsFailure: true,
    });
  });

  /**
   * ⚠ Checked BEFORE comparing, so a locked session stops confirming which code
   * is right — the right code is refused too.
   */
  it('⚠ refuses even the RIGHT code once the attempts are used up', () => {
    const locked = { ...session, failedCodeAttempts: MAX_FAILED_CODE_ATTEMPTS };
    expect(evaluateCodeExchange({ session: locked, typed: 'K7QM4XHT', activeDisplays: 0 })).toEqual({
      accepted: false,
      reason: 'locked',
      countsAsFailure: false,
    });
  });

  it('allows the twentieth attempt and locks from there', () => {
    expect(MAX_FAILED_CODE_ATTEMPTS).toBe(20);
    const nineteen = { ...session, failedCodeAttempts: 19 };
    expect(evaluateCodeExchange({ session: nineteen, typed: 'K7QM4XHT', activeDisplays: 0 })).toEqual({
      accepted: true,
    });
  });

  it('refuses a right code on a full session without counting it as a failure', () => {
    expect(evaluateCodeExchange({ session, typed: 'K7QM4XHT', activeDisplays: 5 })).toEqual({
      accepted: false,
      reason: 'display_cap',
      countsAsFailure: false,
    });
  });
});

describe('isDisplayPassShaped', () => {
  it('accepts 43 base64url characters — 256 bits', () => {
    expect(isDisplayPassShaped(`${'A'.repeat(41)}-_`)).toBe(true);
  });

  it.each([
    ['too short', 'A'.repeat(42)],
    ['too long', 'A'.repeat(44)],
    ['padded base64', `${'A'.repeat(42)}=`],
    ['standard base64', `${'A'.repeat(42)}+`],
    ['not a string', 42],
    ['a display code', 'K7QM4XHT'],
  ])('refuses %s', (_label, value) => {
    expect(isDisplayPassShaped(value)).toBe(false);
  });
});
