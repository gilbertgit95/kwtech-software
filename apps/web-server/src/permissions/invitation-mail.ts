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
  appRole,
  expiresAt,
}) => {
  const url = `${env.PERMISSIONS_INVITE_URL_BASE}?token=${encodeURIComponent(token)}`;
  /*
   * WHAT they are being invited to, in the words of the offer.
   *
   * `organization` is null for a PLATFORM invitation — one that grants an
   * app-level role and no membership. The module hands over the null rather
   * than a placeholder precisely so this decision is the app's: only the app
   * knows what its own product is called, and "invited to join —" is the kind
   * of email that gets reported as phishing.
   */
  const brand = env.MAIL_BRAND ?? env.APP_NAME;
  const message = renderEmail('organization-invitation', {
    /* The subject's noun. The product itself when no tenant was named. */
    organizationName: organization?.name ?? brand,
    /*
     * Whole SENTENCES rather than fragments the template stitches together.
     * The two cases differ by more than a name — one is "somebody at a company
     * has invited you", the other is "the platform has" — and expressing that
     * as conditionals inside a template is how an email ends up reading like a
     * form letter with a hole in it.
     */
    intro: organization
      ? `Someone at ${organization.name} has invited you to join them on ${brand}.`
      : `You have been invited to ${brand}.`,
    // Named when there is one, because on a platform invitation the role IS the
    // offer — there is no organization to describe instead.
    roleLine: appRole ? `You will join as ${appRole.label}.` : '',
    joinLine: organization
      ? `you will join ${organization.name} as soon as you have finished.`
      : 'your account will be ready as soon as you have finished.',
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
        '  INVITATION LINK — dev only, no SMTP_URL configured',
        // Names the offer, which is the thing a developer reading this needs:
        // an organization, or the platform itself.
        `  ${email} → ${organization?.name ?? brand}${appRole ? ` (${appRole.label})` : ''} · expires ${expiresAt.toISOString()}`,
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
