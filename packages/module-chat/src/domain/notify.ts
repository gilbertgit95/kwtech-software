/**
 * ── BEING TOLD WITH THE TAB CLOSED ─────────────────────────────────────────
 *
 * The tone only plays in an open tab, which satisfies "people are told on time"
 * only for somebody already looking (§12.50). This is the rule that decides
 * who gets reached some other way.
 *
 * ⚠ Pure, and in the domain, because it is the half that decides WHETHER —
 * the app owns HOW, and the two must not be tangled. A rule living inside a
 * mail adapter is one nobody can test without a mail server, and one that
 * silently changes the day the adapter does.
 *
 * ⚠ IT DOES NOT NAME EMAIL. Every input here is about chat, and a Web Push
 * implementation would ask exactly the same question. The transport is the
 * app's business (§12.50 keeps push open); this decides who is owed a nudge.
 */

/**
 * ⚠ A COOLDOWN, PER PERSON PER CONVERSATION, and it is the difference between
 * a notification and a mail flood.
 *
 * A ten-message burst is one conversation, not ten events worth telling
 * somebody about separately. Fifteen minutes because it is long enough that a
 * back-and-forth produces one nudge, and short enough that a genuinely new
 * conversation hours later is not suppressed by a stale mark.
 *
 * ⚠ Deliberately NOT a digest. A digest needs a scheduler and there is none in
 * this repo (§12.40) — promising one would be promising something nothing
 * keeps. A cooldown needs no clock of its own: it is read at the moment a
 * message arrives, which is the only moment anything here runs.
 */
export const NOTIFY_COOLDOWN_MS = 15 * 60 * 1000;

export interface NotifyDecision {
  /** The person who might be told. */
  recipientId: string;
  /** Who wrote it. Null for a `kind: system` message, which tells nobody. */
  authorId: string | null;
  /** Their participant status in this conversation. */
  status: string;
  /** ⚠ Whether they hold a live socket right now. */
  recipientOnline: boolean;
  /** Their declared availability. `dnd` suppresses DELIVERY here — §12.44. */
  availability: string | null;
  /** This conversation's own mute, which outranks everything but presence. */
  mutedUntil: Date | null;
  /** When this person was last told about THIS conversation. */
  lastNotifiedAt: Date | null;
  now: Date;
}

/**
 * @returns true when this person should be reached outside the browser.
 *
 * ⚠ Every refusal below is an email somebody would otherwise have received and
 * been annoyed by, which is the failure mode that gets a notification system
 * switched off entirely:
 *
 *   your own          you know what you sent.
 *   system            "X left" is from nobody and is addressed to nobody.
 *   not active        an INVITED person is told by the invitation, not by every
 *                     message in a thread they have not accepted; somebody who
 *                     LEFT asked not to be here.
 *   ⚠ online          they hold a socket, so the badge moved and the tone
 *                     played. Mailing them as well is telling somebody
 *                     something they are currently watching.
 *   ⚠ dnd            §12.44 said this is the moment `dnd` stops being
 *                     presentation and starts being delivery. It is.
 *   muted            the per-conversation mute, which is what people actually
 *                     want far more than a global switch.
 *   within cooldown  a burst is one conversation, not ten notifications.
 */
export function shouldNotify(decision: NotifyDecision): boolean {
  if (decision.authorId === null) return false;
  if (decision.authorId === decision.recipientId) return false;
  if (decision.status !== 'active') return false;
  if (decision.recipientOnline) return false;
  if (decision.availability === 'dnd') return false;

  if (decision.mutedUntil && decision.mutedUntil.getTime() > decision.now.getTime()) return false;

  if (decision.lastNotifiedAt) {
    const since = decision.now.getTime() - decision.lastNotifiedAt.getTime();
    if (since < NOTIFY_COOLDOWN_MS) return false;
  }

  return true;
}
