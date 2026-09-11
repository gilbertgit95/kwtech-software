import type { ConversationView, ParticipantView } from '../types.js';
import { canAccessConversation } from './participation.js';

/**
 * What makes a conversation a DIRECT one, and what the cap counts.
 */

/**
 * The unique key for a direct chat between two people.
 *
 * ⚠ COMPUTED SERVER-SIDE, ALWAYS. A client-supplied `directKey` forges a DM
 * between two other people: send `alice:bob` and you are in their conversation.
 * This function exists so there is exactly one place that builds one, and so the
 * server has no reason to accept the value from anywhere else.
 *
 * Sorted, so `directKey(a, b)` and `directKey(b, a)` are the same string — which
 * is what the unique constraint needs in order to stop two simultaneous
 * "message Bob" clicks producing two threads.
 *
 * ⚠ SELF-DM IS ALLOWED, deliberately rather than by accident: `directKey(a, a)`
 * is `a:a`, a notes-to-self thread. Left undefined, the same call would have
 * produced a one-participant "direct" conversation nobody decided to have.
 */
export function directKeyFor(userA: string, userB: string): string {
  return [userA, userB].sort().join(':');
}

/** A group carries no direct key. Reading it from the row, never inferring it from a count. */
export function isDirect(conversation: ConversationView): boolean {
  return conversation.directKey !== null;
}

/**
 * Whether this conversation spends one of ITS CREATOR'S cap slots.
 *
 * Three conditions, and each rejects an alternative that was considered:
 *
 *   not archived   archiving FREES a slot, so the cap is something a person can
 *                  clear rather than a wall. Counting every chat ever created
 *                  would make the cap permanent.
 *   created by me  being INVITED to a chat costs the invitee nothing. A cap
 *                  other people can spend on your behalf is a griefing tool, not
 *                  a limit — which is why counting all participation was
 *                  rejected harder.
 *   ⚠ still in it  added when leaving was designed. Without it,
 *                  create-twenty-and-leave-them-all is unlimited chats.
 *
 * The server counts rows matching this and hands the number to the
 * `LimitChecker` port; nothing here reads a database. That split is what lets
 * `module-permissions` resolve the cap without ever learning that
 * `chat_conversation` exists.
 */
export function countsTowardCap(
  conversation: ConversationView,
  participant: ParticipantView | null | undefined,
  userId: string,
): boolean {
  if (conversation.createdById !== userId) return false;
  if (conversation.archivedAt != null) return false;
  return canAccessConversation(participant);
}

/**
 * Whether one more group fits, given a decision the host's `LimitChecker` made.
 *
 * ⚠ DIRECT CHATS DO NOT COUNT, and the asymmetry is the point: the cap exists to
 * bound how many rooms one person can stand up, not to ration who they may talk
 * to. A direct chat is bounded by the other person — they can block, decline, or
 * leave — where a group is bounded by nothing at all.
 *
 * Trivial, and it is a function rather than an inlined `decision.allowed` so
 * there is a single documented place to read the rule, and one place for a
 * future "direct chats count too" to change.
 */
export function groupCapAllows(decision: { allowed: boolean }): boolean {
  return decision.allowed;
}
