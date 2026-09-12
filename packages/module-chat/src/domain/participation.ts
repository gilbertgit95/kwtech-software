import type { ParticipantStatus, ParticipantView } from '../types.js';

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
export function canSeeInvitation(
  participant: ParticipantView | null | undefined,
): participant is ParticipantView & { status: 'invited' } {
  return participant?.status === 'invited';
}

/** Anything the person is expected to see in their conversation list. */
export function isLiveParticipant(
  participant: ParticipantView | null | undefined,
): participant is ParticipantView & { status: 'active' | 'invited' } {
  return canAccessConversation(participant) || canSeeInvitation(participant);
}

/**
 * May this person send into this conversation?
 *
 * The KEY is checked elsewhere — by the guard, against `chat:send`. This is the
 * other half, and both are required: holding the key without the row is C1, and
 * holding the row without the key is a revoked account still talking.
 */
export function canSendTo(participant: ParticipantView | null | undefined): participant is ActiveParticipant {
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

/**
 * ⚠ `refuseRemoval` LIVED HERE AND IS GONE — superseded by `refuseRoleRemoval`
 * in `participant-roles.ts`, 2026-09-12.
 *
 * It answered "who may remove whom" with the only vocabulary available at the
 * time: the CREATOR could not be removed and everybody else could remove
 * anybody. That was never a decision about authority, it was the absence of
 * one — there was no word for an owner or a delegate, so `createdById` stood in
 * for both and every other participant was equal.
 *
 * The replacement asks the participant's ROLE, and the invariant moved with it:
 * it is the OWNER who cannot be removed, not the creator, because ownership can
 * be handed on while `createdById` never moves. Kept as a note rather than a
 * deprecated export: a second answer to one question is how the two drift.
 */
