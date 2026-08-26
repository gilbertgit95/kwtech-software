import type { AuthModuleOptions } from '@kwtech/module-auth/server';
import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { renderEmail } from '../mail/render.js';

const logger = new Logger('PasswordReset');

/**
 * How a reset link reaches its owner.
 *
 * The module hands this function the RAW token exactly once and never stores it
 * in that form; everything about delivery is the app's, which is why this is
 * the only file that knows mail exists. Replacing nodemailer with a provider
 * SDK is a change to `deliver()` and nothing else.
 *
 * Two behaviours, chosen by whether SMTP_URL is set:
 *
 *   set    a real message goes out over SMTP.
 *   unset  the URL is logged, so the flow is walkable locally with no mail
 *          server — and ONLY outside production, where a reset link in an
 *          aggregated log is a working credential in an aggregated log.
 *
 * The production half of that is now also enforced at boot (see config/env.ts),
 * so a deployment missing SMTP_URL never starts. This refusal remains as the
 * second line: env validation can be bypassed by a test or a script that
 * constructs the module directly.
 */

/**
 * One transport for the process, built on first use.
 *
 * Built lazily rather than at import so a missing SMTP_URL is not a boot
 * failure in development, and shared rather than per-message because nodemailer
 * pools connections behind it — a transport per email is a TCP and TLS
 * handshake per email, which is most of the latency and all of the connection
 * churn.
 */
let transport: Transporter | null = null;

function mailer(): Transporter | null {
  if (!env.SMTP_URL) return null;
  transport ??= createTransport(env.SMTP_URL, { from: env.MAIL_FROM });
  return transport;
}

interface ResetMail {
  email: string;
  displayName: string | null;
  url: string;
  expiresAt: Date;
}

/**
 * The message.
 *
 * A `text` part alongside the `html` one, always: HTML-only mail scores badly
 * with spam filters, and the one email in this system that must arrive is this
 * one. Both come out of `../mail/render.ts`, from the templates in
 * `src/mail/templates/` — nothing a recipient reads is written in this file.
 * Neither part is logged: the URL contains the token.
 */
async function deliver({ email, displayName, url, expiresAt }: ResetMail): Promise<void> {
  const post = mailer();

  // FACTS only. The wording is the template's, including the subject — see
  // ../mail/render.ts for why that lives in the .txt file rather than here.
  //
  // Rendered BEFORE the no-mailer branch below, deliberately. Rendering only on
  // the sending path would mean a broken template — a typo in a tag, a renamed
  // field — first surfaced in production, because the whole of local
  // development runs down the other branch.
  const message = renderEmail('password-reset', { displayName, url, expiresIn: 'one hour' });

  if (!post) {
    if (env.NODE_ENV === 'production') {
      logger.error(`No mailer configured — cannot send a reset link to ${email}`);
      throw new Error('Password reset email is not configured');
    }
    logger.warn(`[dev only] "${message.subject}" for ${email}, valid until ${expiresAt.toISOString()}:\n  ${url}`);
    return;
  }

  await post.sendMail({
    to: email,
    from: env.MAIL_FROM,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}

export const sendPasswordResetEmail: NonNullable<AuthModuleOptions['sendPasswordResetEmail']> = async ({
  user,
  token,
  expiresAt,
}) => {
  const url = `${env.AUTH_RESET_URL_BASE}?token=${encodeURIComponent(token)}`;

  /*
   * DELIBERATELY NOT AWAITED.
   *
   * The module awaits this function, and requestPasswordReset returns
   * immediately for an address it does not recognise. Awaiting an SMTP round
   * trip here would therefore make the KNOWN-address path measurably slower
   * than the unknown one — an account-enumeration oracle in the response time,
   * defeating the identical 202 the endpoint goes to some trouble to produce.
   *
   * The cost is that a delivery failure cannot be reported to the caller. That
   * is already the design's answer: the raw token exists only in this closure,
   * so a failed send means the user asks again, which is the correct direction
   * to fail in.
   */
  void deliver({ email: user.email, displayName: user.displayName, url, expiresAt }).catch((error: unknown) => {
    // The address, never the URL.
    logger.error(`Could not deliver a reset link to ${user.email}`, error instanceof Error ? error.stack : error);
  });
};
