import type { AuthModuleOptions } from '@kwtech/module-auth/server';
import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { renderEmail } from '../mail/render.js';

const logger = new Logger('MfaEmailCode');

/**
 * How an emailed two-step verification code reaches its owner.
 *
 * The module hands this function the RAW code exactly once and stores only a
 * scrypt hash of it. Same two behaviours as `./reset-mail.ts`, chosen by
 * SMTP_URL:
 *
 *   set    a real message goes out over SMTP.
 *   unset  the code is logged, so the flow is walkable locally with no mail
 *          server — and ONLY outside production, where a code in an aggregated
 *          log is a working second factor in an aggregated log.
 *
 * AWAITED by the module, unlike the reset link, and so errors are THROWN here
 * rather than swallowed: there is no enumeration to hide (the caller already
 * proved the password), and "could not send" is what a person looking at an
 * empty inbox needs to hear. The module turns the throw into a 503 sentence.
 */

/** One transport for the process, built on first use — see reset-mail.ts for why. */
let transport: Transporter | null = null;

function mailer(): Transporter | null {
  if (!env.SMTP_URL) return null;
  transport ??= createTransport(env.SMTP_URL, { from: env.MAIL_FROM });
  return transport;
}

/** Wide enough to stand out in a terminal, narrow enough not to wrap in a default one. */
const RULE = '─'.repeat(76);

/** The code's lifetime in words. The module's EMAIL_MFA_CODE_TTL is ten minutes. */
function inWords(expiresAt: Date): string {
  const minutes = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/**
 * The two messages differ by their sentences, not their shape. The "not you"
 * line is the one that matters: at sign-in, an unexpected code means somebody
 * HAS the password, and the honest instruction is to change it.
 */
const COPY = {
  sign_in: {
    intro:
      'Someone signed in to your account with your password and asked for a verification code. Enter it to finish signing in.',
    notYou: "Didn't try to sign in? Someone knows your password. Change it now — they can't get in without this code.",
  },
  enrolment: {
    intro: 'Enter this code to turn on email codes for two-step verification.',
    notYou:
      "Didn't ask for this? Someone may be signed in to your account. Change your password and sign out everywhere.",
  },
} as const;

export const sendMfaEmailCode: NonNullable<AuthModuleOptions['sendMfaEmailCode']> = async (input) => {
  /*
   * EVERY failure is logged here, the render included — the module turns a
   * throw into a 503 sentence for the person and keeps no log of its own, so
   * this is the only place an operator can learn WHY. A missing template was
   * exactly that once: a 503 on the form and nothing in the log.
   */
  try {
    await deliver(input);
  } catch (error) {
    // The address, never the code.
    logger.error(
      `Could not deliver a verification code to ${input.user.email}`,
      error instanceof Error ? error.stack : error,
    );
    throw error;
  }
};

async function deliver({
  user,
  code,
  expiresAt,
  purpose,
}: Parameters<NonNullable<AuthModuleOptions['sendMfaEmailCode']>>[0]): Promise<void> {
  // Rendered before the no-mailer branch, so a broken template fails in
  // development rather than first in production — the reason reset-mail.ts gives.
  const message = renderEmail('mfa-code', {
    displayName: user.displayName,
    code,
    expiresIn: inWords(expiresAt),
    ...COPY[purpose],
  });

  const post = mailer();
  if (!post) {
    if (env.NODE_ENV === 'production') throw new Error('Verification code email is not configured');
    // The code ALONE on its line, so a double-click selects exactly it. Dev only.
    logger.warn(
      [
        '',
        RULE,
        `  VERIFICATION CODE (${purpose}) — dev only, no SMTP_URL configured`,
        `  ${user.email} · expires ${expiresAt.toISOString()}`,
        '',
        code,
        '',
        RULE,
      ].join('\n'),
    );
    return;
  }

  await post.sendMail({
    to: user.email,
    from: env.MAIL_FROM,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
