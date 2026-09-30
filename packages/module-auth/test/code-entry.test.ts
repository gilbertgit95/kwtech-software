import { EMAIL_MFA_RESEND_SECONDS, isPlausibleRecoveryCode, normaliseMfaCode } from '../src/domain/policy.js';
import { cleanCode, groupRecoveryCode, isCodeComplete, resendSecondsLeft } from '../src/react/view/code-entry.js';

describe('cleanCode — what the code boxes accept', () => {
  it('keeps the digits of a pasted code, whatever surrounds them', () => {
    expect(cleanCode('123 456', 'digits')).toBe('123456');
    expect(cleanCode('Your code is 123-456.', 'digits')).toBe('123456');
  });

  it('⚠ keeps a leading zero — one code in ten starts with one', () => {
    expect(cleanCode('012345', 'digits')).toBe('012345');
  });

  it('stops at six digits, so a longer paste cannot overflow the boxes', () => {
    expect(cleanCode('1234567890', 'digits')).toBe('123456');
  });

  it('upper-cases a recovery code and drops what base32 cannot contain', () => {
    expect(cleanCode('abcd-efgh 2345 ', 'recovery')).toBe('ABCDEFGH2345');
    // 0, 1, 8 and 9 are not base32 letters, so they cannot be part of one.
    expect(cleanCode('A0B1C8D9', 'recovery')).toBe('ABCD');
  });
});

describe('isCodeComplete — when the code sends itself', () => {
  it('is complete at six digits and not before', () => {
    expect(isCodeComplete('12345', 'digits')).toBe(false);
    expect(isCodeComplete('123456', 'digits')).toBe(true);
  });

  it('is complete at the length the server checks recovery codes for', () => {
    const code = 'ABCDEFGHIJKLMNOP';
    expect(isCodeComplete(code, 'recovery')).toBe(true);
    expect(isPlausibleRecoveryCode(code)).toBe(true);
    expect(isCodeComplete(code.slice(1), 'recovery')).toBe(false);
  });
});

describe('groupRecoveryCode', () => {
  it('shows a recovery code in fours, which the server reads back as the bare code', () => {
    const grouped = groupRecoveryCode('ABCDEFGHIJKLMNOP');
    expect(grouped).toBe('ABCD-EFGH-IJKL-MNOP');
    expect(normaliseMfaCode(grouped)).toBe('ABCDEFGHIJKLMNOP');
  });

  it('adds no trailing hyphen, so deleting back past a group works', () => {
    expect(groupRecoveryCode('ABCD')).toBe('ABCD');
    expect(groupRecoveryCode('')).toBe('');
  });
});

describe('resendSecondsLeft', () => {
  const sentAt = Date.parse('2026-09-30T09:00:00Z');

  it('allows a first send', () => {
    expect(resendSecondsLeft(null, sentAt)).toBe(0);
  });

  it('counts down the same wait the server enforces', () => {
    expect(resendSecondsLeft(sentAt, sentAt)).toBe(EMAIL_MFA_RESEND_SECONDS);
    expect(resendSecondsLeft(sentAt, sentAt + 29_500)).toBe(1);
    expect(resendSecondsLeft(sentAt, sentAt + EMAIL_MFA_RESEND_SECONDS * 1000)).toBe(0);
  });
});
