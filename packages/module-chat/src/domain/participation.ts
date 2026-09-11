import type { ConversationView, ParticipantStatus, ParticipantView } from '../types.js';

/**
 * PARTICIPATION IS NOT PERMISSION.
 *
 * This is C1 one table over, and it is the reason this file has tests before it
 * has a screen. All three critical findings in PERMISSIONS-REVIEW shared one
 * shape: the guard answered "may this user do X" without asking "is X somewhere
 * this user may be". `chat:send` says you may use chat. It says nothing about
 * conversation 42.
 *
 * ⚠ C1's exact failure was a helper that existed, was exported, was used by the
 * React layer, and was never called server-side. So: every read, every send and
 * every PUBLISHED EVENT re-asks these questions on the server.
 */

/** The one status that resolves anything. */
const ACTIVE: ParticipantStatus = 'active';

/**
 * May this person read this conversation and everything in it?
 *
 * ⚠ ACTIVE ONLY, and every other status answers no for a different reason worth
 * keeping distinct:
 *
 *   invited   has not accepted. Sees THAT they were invited (`canSeeInvitation`)
 *             and nothing inside.
 *   declined  said no. The row survives so a re-invite flips it back rather than
 *             inserting a second one — it is the memory of the refusal, not a
 *             grant.
 *   left      chose to go.
 *   removed   was taken out.
 *
 * The last two are the ones silence would leak: a `left` participant whose
 * subscription still delivered would keep receiving a conversation they walked
 * out of. No status resolves history — leaving does not retract what was already
 * read, but it stops everything after it.
 *
 * `undefined` — no row at all — is the ordinary case for every conversation in
 * the system that is not yours, and answers no without comment.
 */
export function canAccessConversation(
  participant: ParticipantView | null | undefined,
): participant is ActiveParticipant {
  return participant?.status === ACTIVE;
}

/**
 * A participant row already checked. The type predicate above is not a
 * convenience: without it every caller re-tests for null to read `userId`, and a
 * caller that forgets has an `undefined.userId` where it meant to compare people
 * — which throws at the moment somebody sends a message rather than at review.
 */
export type ActiveParticipant = ParticipantView & { status: 'active' };

/**
 * May this person see that they were INVITED — the requests inbox?
 *
 * Deliberately separate from access, and narrower than it looks: it admits the
 * conversation's existence and who invited them, never its messages. Rendering
 * somebody else's message content to a non-participant is exactly the failure
 * `canAccessConversation` exists to prevent.
 */
export function canSeeInvitation(participant: ParticipantView | null | undefined): boolean {
  return participant?.status === 'invited';
}

/** Anything the person is expected to see in their conversation list. */
export function isLiveParticipant(participant: ParticipantView | null | undefined): boolean {
  return canAccessConversation(participant) || canSeeInvitation(participant);
}

/**
 * May this person send into this conversation?
 *
 * The KEY is checked elsewhere — by the guard, against `chat:send`. This is the
 * other half, and both are required: holding the key without the row is C1, and
 * holding the row without the key is a revoked account still talking.
 */
export function canSendTo(participant: ParticipantView | null | undefined): boolean {
  return canAccessConversation(participant);
}

export type ParticipantTransition = 'accept' | 'decline' | 'leave' | 'remove' | 'reinvite';

/**
 * The whole state machine, in one place, as a pure function.
 *
 * Returns the next status, or `null` when the move is not available from here —
 * which the caller turns into a refusal rather than a no-op, because "you are
 * not in this conversation" and "nothing changed" are different answers.
 *
 * ⚠ `reinvite` FLIPS A DECLINED ROW BACK rather than inserting a second one.
 * That is what makes a decline BOUND re-invitation instead of resetting it: the
 * row remembers, so a caller can rate-limit on it. Inserting a fresh row each
 * time would erase the memory, and "declining only lets them ask again
 * immediately" is the harassment vector this design already refused once.
 */
export function nextParticipantStatus(
  current: ParticipantStatus,
  transition: ParticipantTransition,
): ParticipantStatus | null {
  switch (transition) {
    case 'accept':
      // Only from an outstanding invitation. Accepting twice is not an error
      // worth inventing, but accepting after being REMOVED would re-admit
      // somebody who was taken out.
      return current === 'invited' ? 'active' : null;
    case 'decline':
      return current === 'invited' ? 'declined' : null;
    case 'leave':
      // From either live state. Declining an invitation you have not accepted is
      // `decline`; leaving after accepting is `left`. Both are the person's own
      // choice, which is why neither needs a key.
      return current === 'active' || current === 'invited' ? 'left' : null;
    case 'remove':
      return current === 'active' || current === 'invited' ? 'removed' : null;
    case 'reinvite':
      return current === 'declined' || current === 'left' || current === 'removed' ? 'invited' : null;
  }
}

export interface RemovalRequest {
  conversation: ConversationView;
  /** The remover's own participant row. */
  actor: ParticipantView | null | undefined;
  /** The row being removed. */
  target: ParticipantView | null | undefined;
}

/**
 * Why a removal is refused, or `null` when it may proceed.
 *
 * A REASON rather than a boolean, because every one of these is shown to
 * somebody who needs to know which rule stopped them — and because
 * "self_removal" is not a refusal the UI should surface as an error at all: it
 * means the person wanted `leave`.
 *
 * ⚠ Who may remove whom was UNDEFINED in the first design, and it touched the
 * cap: a member removing the creator would free the creator's quota slot and
 * orphan the group.
 */
export type RemovalRefusal = 'not_a_participant' | 'target_not_present' | 'self_removal' | 'creator';

export function refuseRemoval({ conversation, actor, target }: RemovalRequest): RemovalRefusal | null {
  // Holding `chat:remove_participant` is not standing in the room. The guard
  // checks the key; this checks the room.
  if (!canAccessConversation(actor)) return 'not_a_participant';
  if (!target || nextParticipantStatus(target.status, 'remove') === null) return 'target_not_present';
  if (actor.userId === target.userId) return 'self_removal';
  /*
   * ⚠ THE CREATOR CANNOT BE REMOVED BY ANYBODY ELSE.
   *
   * `createdById` never moves, and the cap counts live chats you created AND are
   * still in — so removing the creator would hand their quota back while leaving
   * the group standing with an owner who is not in it. The creator may LEAVE,
   * which frees the slot honestly and is their own decision.
   */
  if (target.userId === conversation.createdById) return 'creator';
  return null;
}
