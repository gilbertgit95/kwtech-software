import type { ChatNotification, ChatNotifier } from '@kwtech/module-chat/server';
import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { renderEmail } from '../mail/render.js';
import { PrismaService } from '../prisma/prisma.service.js';

const logger = new Logger('ChatNotify');

/**
 * How a message reaches somebody whose tab is closed — §12.50, answered with
 * EMAIL rather than Web Push (decided 2026-09-13).
 *
 * ## Why the app and not the module
 *
 * `module-chat` decides WHO is owed a nudge and cannot send one: it has no
 * mail server, no idea what an email address is, and no business acquiring
 * either. This is the same seam `reset-mail.ts` sits on one module over —
 * `module-auth` hands over a raw token and the app owns delivery.
 *
 * ⚠ Which is also what keeps Web Push open. The port carries ids and a
 * group/direct flag; a push implementation replaces this class and changes
 * nothing in the module.
 *
 * ## ⚠ IT SENDS NO MESSAGE TEXT
 *
 * The subject says who wrote, the body says that they wrote, and the button
 * opens the conversation. What was SAID never leaves the product. An inbox is a
 * copy of the conversation outside anything `canAccessConversation` can reach —
 * in a mail provider's logs, on a lock screen, and outliving the account. The
 * port does not carry the body, so this cannot include it even by mistake.
 *
 * ## ⚠ Why it never throws
 *
 * It is called after a message has committed and gone out on the socket. A mail
 * server that is down must not turn a delivered message into a failed send, so
 * every failure is logged and swallowed. `notifyAbsent` guards it as well —
 * neither side trusts the other to remember.
 */
@Injectable()
export class ChatMailNotifier implements ChatNotifier {
  constructor(private readonly prisma: PrismaService) {}

  async notify(notification: ChatNotification): Promise<void> {
    try {
      const [recipient, sender] = await Promise.all([
        this.prisma.authUser.findUnique({
          where: { id: notification.recipientId },
          select: { email: true, displayName: true, username: true, status: true },
        }),
        this.prisma.authUser.findUnique({
          where: { id: notification.senderId },
          select: { displayName: true, username: true },
        }),
      ]);

      /*
       * ⚠ ACTIVE ACCOUNTS ONLY. A suspended or deleted account is somebody the
       * platform has stopped serving, and mailing them because a conversation
       * they used to be in is still busy is the kind of thing that gets a
       * domain reported.
       */
      if (!recipient?.email || recipient.status !== 'active') return;

      const message = renderEmail('chat-message', {
        displayName: recipient.displayName ?? recipient.username ?? null,
        // ⚠ A NAME, never an id: "cmg7x2p sent you a message" is worse than
        // nothing. Falls back through the same chain the directory uses.
        senderName: sender?.displayName ?? sender?.username ?? 'Somebody',
        isGroup: notification.isGroup,
        /*
         * ⚠ `/chat`, not `/chat/<id>`. There is no per-conversation route —
         * the thread is selected inside the page — so a link carrying an id
         * would 404 today. It is also the safer default: a link that names a
         * conversation id in a mailbox is a conversation id in a mailbox.
         */
        url: `${env.CHAT_URL_BASE}`,
      });

      const post = this.mailer();
      if (!post) {
        /*
         * ⚠ NOT an error, unlike the password-reset path. A reset link that
         * cannot be sent strands somebody outside their account; a chat nudge
         * that cannot be sent means they find the message when they next open
         * the app, which is exactly the behaviour before this existed. So
         * development runs with no mail server and logs instead, and production
         * — where env validation already requires SMTP_URL — never reaches here.
         */
        logger.debug(`No mailer configured — not telling ${recipient.email} about a new message`);
        return;
      }

      await post.sendMail({
        to: recipient.email,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (cause) {
      // See the class comment: a delivered message must not fail because the
      // thing that tells people about it is unwell.
      logger.warn(`Could not send a chat notification: ${cause instanceof Error ? cause.message : 'unknown'}`);
    }
  }

  /**
   * One transport for the process, built on first use.
   *
   * The same arrangement `reset-mail.ts` makes and for the same reason:
   * nodemailer pools connections behind a transport, so one per message is a
   * TCP and TLS handshake per message.
   */
  private static transport: Transporter | null = null;

  private mailer(): Transporter | null {
    if (!env.SMTP_URL) return null;
    ChatMailNotifier.transport ??= createTransport(env.SMTP_URL, { from: env.MAIL_FROM });
    return ChatMailNotifier.transport;
  }
}
