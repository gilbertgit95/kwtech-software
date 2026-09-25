import type { MfaFactorSummary } from '../../types.js';

/**
 * How well an account is protected, as the Security page summarises it.
 *
 *   unknown   the factor list has not arrived, or failed to. NOT "basic":
 *             telling someone they are unprotected because a fetch failed is a
 *             lie in the dangerous direction — it invites a second enrolment,
 *             or panic.
 *   basic     a password alone.
 *   good      a second step, but only email codes — as safe as the mailbox.
 *   strong    an authenticator app.
 */
export type SecurityLevel = 'unknown' | 'basic' | 'good' | 'strong';

/** One line of the checklist under the summary. */
export interface SecurityCheck {
  key: 'password' | 'two_factor' | 'authenticator';
  label: string;
  /** `null` when it cannot be known yet — rendered as neither a tick nor a warning. */
  met: boolean | null;
}

export interface SecurityView {
  level: SecurityLevel;
  headline: string;
  detail: string;
  /** Confirmed factors only. An unconfirmed one grants and blocks nothing, so it is not listed. */
  factors: MfaFactorSummary[];
  twoFactorOn: boolean;
  checks: SecurityCheck[];
}

/**
 * The summary for a factor list, or for `null` while it is loading or failed.
 *
 * Pure, and here rather than in the page, so the one judgement on the screen that
 * could frighten or falsely reassure someone is the one with tests.
 */
export function summariseSecurity(factors: readonly MfaFactorSummary[] | null): SecurityView {
  if (factors === null) {
    return {
      level: 'unknown',
      headline: 'Checking your account…',
      detail: 'Looking up how you sign in.',
      factors: [],
      twoFactorOn: false,
      checks: [
        { key: 'password', label: 'Password', met: true },
        { key: 'two_factor', label: 'Two-step verification', met: null },
        { key: 'authenticator', label: 'Authenticator app', met: null },
      ],
    };
  }

  const confirmed = factors.filter((factor) => factor.confirmedAt !== null);
  const hasTotp = confirmed.some((factor) => factor.type === 'totp');
  const level = securityLevel(confirmed.length > 0, hasTotp);

  return {
    level,
    ...SECURITY_COPY[level],
    factors: confirmed,
    twoFactorOn: confirmed.length > 0,
    checks: [
      // Shown as met because the page has no way to ask otherwise; the row is
      // there so the checklist reads as layers, the password being the first.
      { key: 'password', label: 'Password', met: true },
      { key: 'two_factor', label: 'Two-step verification', met: confirmed.length > 0 },
      { key: 'authenticator', label: 'Authenticator app', met: hasTotp },
    ],
  };
}

function securityLevel(twoFactorOn: boolean, hasTotp: boolean): Exclude<SecurityLevel, 'unknown'> {
  if (hasTotp) return 'strong';
  if (twoFactorOn) return 'good';
  return 'basic';
}

const SECURITY_COPY: Record<Exclude<SecurityLevel, 'unknown'>, { headline: string; detail: string }> = {
  strong: {
    headline: 'Your account is well protected',
    detail: 'Signing in needs your password and a code from your authenticator app.',
  },
  good: {
    headline: 'Your account is protected',
    detail: 'Signing in needs a code sent to your email. An authenticator app is safer still.',
  },
  basic: {
    headline: 'Add a second step to protect your account',
    detail: 'Right now your password is all it takes to sign in as you.',
  },
};

/** A factor's name as a person would say it. Email codes have no label of their own worth showing. */
export function factorName(factor: Pick<MfaFactorSummary, 'type' | 'label'>): string {
  switch (factor.type) {
    case 'email':
      return 'Email codes';
    case 'totp':
      return factor.label ? `Authenticator app · ${factor.label}` : 'Authenticator app';
    case 'webauthn':
      return factor.label ? `Security key · ${factor.label}` : 'Security key';
  }
}

/**
 * "Last used 3 Sep 2026" or "Not used yet".
 *
 * `locale` is a parameter so a test does not depend on the machine's.
 */
export function factorUsage(factor: Pick<MfaFactorSummary, 'lastUsedAt'>, locale?: string): string {
  if (!factor.lastUsedAt) return 'Not used yet';
  const date = new Date(factor.lastUsedAt);
  if (Number.isNaN(date.getTime())) return 'Not used yet';
  return `Last used ${date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
