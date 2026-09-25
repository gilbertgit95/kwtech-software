import { factorName, factorUsage, summariseSecurity } from '../src/react/view/security-view.js';
import type { MfaFactorSummary } from '../src/types.js';

function factor(overrides: Partial<MfaFactorSummary>): MfaFactorSummary {
  return {
    id: 'f1',
    type: 'totp',
    label: 'My phone',
    confirmedAt: '2026-09-01T00:00:00.000Z',
    lastUsedAt: null,
    ...overrides,
  };
}

describe('summariseSecurity', () => {
  it('says nothing either way while the factors are unknown', () => {
    // A failed fetch rendered as "unprotected" would invite a needless second
    // enrolment; rendered as "protected" it would falsely reassure.
    const view = summariseSecurity(null);
    expect(view.level).toBe('unknown');
    expect(view.twoFactorOn).toBe(false);
    expect(view.checks.find((check) => check.key === 'two_factor')?.met).toBeNull();
  });

  it('is basic with a password alone', () => {
    const view = summariseSecurity([]);
    expect(view.level).toBe('basic');
    expect(view.twoFactorOn).toBe(false);
  });

  it('ignores a factor that was never confirmed — it grants and blocks nothing', () => {
    const view = summariseSecurity([factor({ confirmedAt: null })]);
    expect(view.level).toBe('basic');
    expect(view.factors).toEqual([]);
  });

  it('is good, not strong, with email codes only', () => {
    const view = summariseSecurity([factor({ type: 'email', label: '' })]);
    expect(view.level).toBe('good');
    expect(view.checks.find((check) => check.key === 'authenticator')?.met).toBe(false);
  });

  it('is strong with an authenticator app', () => {
    const view = summariseSecurity([factor({}), factor({ id: 'f2', type: 'email', label: '' })]);
    expect(view.level).toBe('strong');
    expect(view.factors).toHaveLength(2);
    expect(view.checks.every((check) => check.met === true)).toBe(true);
  });
});

describe('factorName', () => {
  it('names each kind the way a person would', () => {
    expect(factorName({ type: 'email', label: 'ignored' })).toBe('Email codes');
    expect(factorName({ type: 'totp', label: 'iPhone' })).toBe('Authenticator app · iPhone');
    expect(factorName({ type: 'totp', label: '' })).toBe('Authenticator app');
  });
});

describe('factorUsage', () => {
  it('says "Not used yet" for a missing or unreadable date', () => {
    expect(factorUsage({ lastUsedAt: null })).toBe('Not used yet');
    expect(factorUsage({ lastUsedAt: 'not a date' })).toBe('Not used yet');
  });

  it('formats a real date', () => {
    expect(factorUsage({ lastUsedAt: '2026-09-03T12:00:00.000Z' }, 'en-GB'))
      // 'Sep' or 'Sept' depending on the ICU build, which is not ours to pin.
      .toMatch(/^Last used 3 Sept? 2026$/);
  });
});
