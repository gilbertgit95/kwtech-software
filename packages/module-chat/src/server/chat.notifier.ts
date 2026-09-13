/**
 * ── THE PORT THAT REACHES A CLOSED TAB ─────────────────────────────────────
 *
 * `module-chat` decides WHO is owed a nudge (`shouldNotify`, in the domain) and
 * cannot SEND one. Delivery is the app's, for the reason every other port here
 * exists: the module must run in an app with no mail server, no push
 * infrastructure and no opinion about either.
 *
 * The precedent is exact — `module-auth` hands the app a raw reset token and
 * the app owns `reset-mail.ts`, which is the only file in the repo that knows
 * nodemailer exists. This is the same seam one module over.
 *
 * ## ⚠ IT CARRIES IDS, NOT ADDRESSES AND NOT WORDS
 *
 * Two deliberate omissions:
 *
 *   - **No email address.** The module has no idea what one is, and should not
 *     start: the app owns identity, so the app resolves the recipient. That is
 *     also what leaves this usable by a Web Push implementation unchanged.
 *   - **⚠ NO MESSAGE BODY.** The notification says that somebody wrote, never
 *     what they wrote — decided 2026-09-13. Conversation content in an inbox
 *     is content in a mail provider's logs, on a lock screen, and in a mailbox
 *     that outlives the account, none of which `canAccessConversation` reaches.
 *     The body is not passed rather than passed-and-not-used, so a future
 *     template cannot quietly start including it.
 */
export interface ChatNotification {
  /** Who to tell. The app resolves how to reach them. */
  recipientId: string;
  /** Who wrote. The app resolves their name — it owns the directory. */
  senderId: string;
  /** Which conversation, so the app can link to it. */
  conversationId: string;
  /**
   * Whether it is a group, so the app can say "in a group" without loading the
   * conversation. ⚠ NOT the title: a group's name is content its members chose
   * and can be anything, and it would travel to a mailbox exactly as a message
   * body would.
   */
  isGroup: boolean;
}

/**
 * How a nudge reaches somebody whose tab is closed.
 *
 * ⚠ MUST NOT THROW, and must not be slow. It is called after a message has
 * already committed and been published, so a failure here has to leave the
 * message sent — the caller guards it anyway, because a port this important is
 * not trusted to remember.
 */
export interface ChatNotifier {
  notify(notification: ChatNotification): Promise<void>;
}
