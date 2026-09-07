import type { PermissionsModuleOptions } from '@kwtech/module-permissions/server';
import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { renderEmail } from '../mail/render.js';

const logger = new Logger('Invitations');

/**
 * How an invitation link reaches the person invited.
 *
 * The twin of `auth/reset-mail.ts`, and deliberately shaped the same way: the
 * module mints a token, stores only its hash, and hands the raw value here
 * exactly once. Everything about delivery — the transport, the URL, the
 * wording — is the app's, which is why a module that knows all about
 * memberships knows nothing about email.
 *
 * The one meaningful difference is that failures are REPORTED rather than
 * swallowed. A reset is fire-and-forget because answering slowly for a known
 * address would leak which addresses exist; an invitation is sent by an
 * authenticated administrator who is looking at the screen, so the module
 * awaits this and turns a throw into `delivered: false` on their result.
 */

/** One pooled transport for the process. See reset-mail.ts for why it is lazy. */
let transport: Transporter | null = null;

function mailer(): Transporter | null {
  if (!env.SMTP_URL) return null;
  transport ??= createTransport(env.SMTP_URL, { from: env.MAIL_FROM });
  return transport;
}

const RULE = '─'.repeat(76);

/**
 * Rendered before the no-mailer branch, for the reason reset-mail gives: a
 * broken template must not first surface in production, where the whole of
 * local development runs down the other path.
 */
export const sendInvitationEmail: NonNullable<PermissionsModuleOptions['sendInvitationEmail']> = async ({
  email,
  token,
  organization,
  expiresAt,
}) => {
  const url = `${env.PERMISSIONS_INVITE_URL_BASE}?token=${encodeURIComponent(token)}`;
  const message = renderEmail('organization-invitation', {
    organizationName: organization.name,
    url,
    expiresIn: 'seven days',
  });

  const post = mailer();
  if (!post) {
    if (env.NODE_ENV === 'production') {
      logger.error(`No mailer configured — cannot send an invitation to ${email}`);
      /*
       * THROWN, not returned. The module catches this and reports
       * `delivered: false` to the administrator who pressed the button, which is
       * the whole reason it awaits the hook. Returning quietly would tell them
       * an email went out that never existed.
       */
      throw new Error('Invitation email is not configured');
    }

    /*
     * A delimited block, and the URL alone on its own line so a double-click
     * selects exactly the link — the same shape reset-mail settled on after the
     * one-line version kept being missed in `pnpm dev`'s interleaved output.
     *
     * Dev only. An invitation link in an aggregated log is a working way into
     * an organization sitting in an aggregated log.
     */
    logger.warn(
      [
        '',
        RULE,
        '  ORGANIZATION INVITATION LINK — dev only, no SMTP_URL configured',
        `  ${email} → ${organization.name} · expires ${expiresAt.toISOString()}`,
        '',
        url,
        '',
        RULE,
      ].join('\n'),
    );
    return;
  }

  await post.sendMail({
    to: email,
    from: env.MAIL_FROM,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
};
