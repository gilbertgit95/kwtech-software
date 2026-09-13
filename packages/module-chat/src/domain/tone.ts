/**
 * ── SHOULD THIS MESSAGE MAKE A SOUND? ──────────────────────────────────────
 *
 * A pure rule, in the domain rather than in the component that plays the note,
 * for the reason every rule here is: the four cases below are each a complaint
 * somebody would otherwise make, and a rule tangled into an event handler is
 * one nobody can read back or test.
 *
 * The player knows about audio. This knows about chat. They meet in one call.
 */

export interface ToneDecision {
  /** The viewer's own id, so their own message can be recognised. */
  viewerId: string;
  /** Who wrote it. Null for a `kind: system` message, which never sounds. */
  authorId: string | null;
  /** The conversation it landed in. */
  conversationId: string;
  /** The conversation on screen right now, if any. */
  openConversationId: string | null;
  /** Whether this browser window has focus. */
  windowFocused: boolean;
  /** The viewer's own availability. `dnd` silences the tone — §12.44. */
  availability: string | null;
  /** The device setting. */
  enabled: boolean;
}

/**
 * @returns true when a tone should be played for this arrival.
 *
 * ⚠ Every `false` below is a real complaint:
 *
 *   off              somebody turned it off and expects silence.
 *   your own         ⚠ it beeps when YOU press send. Every tab you have open.
 *   system           "X left the conversation" is addressed to nobody, and the
 *                    same rule already keeps it out of the unread count.
 *   ⚠ reading it     the conversation is open AND the window is focused, so it
 *                    beeps at you while you watch the message arrive. Both
 *                    halves are required: an open thread in a BACKGROUND tab
 *                    must still sound, because you are not looking at it.
 *   dnd              the one thing "do not disturb" can honestly do until a
 *                    notification system exists (§12.44). ⚠ It is checked here
 *                    rather than by hiding the setting, because availability
 *                    changes while the setting stays put.
 */
export function shouldPlayTone(decision: ToneDecision): boolean {
  if (!decision.enabled) return false;
  if (decision.authorId === null) return false;
  if (decision.authorId === decision.viewerId) return false;
  if (decision.availability === 'dnd') return false;
  if (decision.windowFocused && decision.conversationId === decision.openConversationId) return false;
  return true;
}
