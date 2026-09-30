import { EMAIL_MFA_RESEND_SECONDS, RECOVERY_CODE_LENGTH, TOTP_DIGITS } from '../../domain/policy.js';

/**
 * What the second-step code fields accept as the person types or pastes.
 *
 * Pure, so the rules the boxes follow are tested without rendering them (there
 * are no React render tests here). The SERVER still normalises and checks
 * every code (`normaliseMfaCode`); cleaning here only decides what the boxes
 * show and when a code is complete enough to send.
 *
 *   digits    a six-digit code: from an authenticator app or an email. Both
 *             have the same shape (`EMAIL_MFA_CODE_DIGITS = TOTP_DIGITS`), so
 *             one set of boxes fits both.
 *   recovery  a recovery code: base32, `RECOVERY_CODE_LENGTH` characters.
 */
export type CodeKind = 'digits' | 'recovery';

/**
 * Keeps only what can be part of the code, up to its length.
 *
 * ⚠ A paste of "123 456" or "Your code is 123456" must still fill the boxes: a
 * field that refused anything but six bare digits would make people retype a
 * code their phone offered them whole.
 */
export function cleanCode(raw: string, kind: CodeKind): string {
  if (kind === 'digits') return raw.replace(/\D/g, '').slice(0, TOTP_DIGITS);
  return raw
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '')
    .slice(0, RECOVERY_CODE_LENGTH);
}

/** Whether the code is whole, so it may be sent without a click. */
export function isCodeComplete(code: string, kind: CodeKind): boolean {
  return code.length === (kind === 'digits' ? TOTP_DIGITS : RECOVERY_CODE_LENGTH);
}

/**
 * A recovery code in groups of four (`ABCD-EFGH-…`), the way it is printed on
 * the saved list, so the person can compare the two by eye. The server strips
 * the hyphens (`normaliseMfaCode`).
 */
export function groupRecoveryCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? []).join('-');
}

/**
 * Whole seconds until another email code may be asked for, or 0 when one may.
 *
 * The same wait the server enforces (`canSendEmailMfaCode`). Showing it stops
 * a person clicking "Resend" into a refusal they cannot see the reason for.
 */
export function resendSecondsLeft(sentAt: number | null, now: number): number {
  if (sentAt === null) return 0;
  return Math.max(0, Math.ceil((sentAt + EMAIL_MFA_RESEND_SECONDS * 1000 - now) / 1000));
}
