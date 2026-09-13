import type { ActorAuthority } from '../../domain/participant-roles.js';
import { isChatParticipantRole } from '../../domain/participant-roles.js';
import type { ParticipantView } from '../../types.js';
import type { ChatConversationView } from '../chat-client.js';

/**
 * The rules the conversation list draws itself by — as pure functions over
 * literals, with no React anywhere in them.
 *
 * ⚠ IN `react/` BUT NOT OF IT. These are view rules, so they belong beside the
 * screen that uses them rather than in `domain/`, which is the module's
 * framework-free core and importable by a Nest server. Keeping them out of the
 * components is what lets "what is this conversation called" and "which of
 * these needs answering" be tested with an object literal instead of a rendered
 * tree.
 */

/**
 * What to call a conversation.
 *
 * ⚠ A DIRECT CHAT IS NAMED BY WHO IS IN IT, which is why `title` is nullable in
 * the schema at all: there is nobody to name it and no name to store. So the
 * name is computed from the other participant, every render, and it follows
 * them when they change their display name.
 *
 * The fallbacks matter more than they look. A direct chat whose other
 * participant is missing — a deleted account, a directory that could not answer
 * — must not render as an empty row somebody cannot click on with any
 * confidence. "Someone" is a worse name than a real one and a better one than
 * nothing.
 */
export function conversationTitle(conversation: ChatConversationView): string {
  if (!conversation.isDirect) return conversation.title?.trim() || 'Untitled group';

  const other = conversation.participants.find((participant) => participant.userId !== conversation.myUserId);
  return other?.displayName?.trim() || 'Someone';
}

/**
 * Everybody in it except you, which is what a group's subtitle says.
 *
 * Yourself excluded because you are not news: a row reading "You, Ada, Grace"
 * spends its first word on the one person who is definitely there.
 */
export function otherParticipants(conversation: ChatConversationView): string[] {
  return conversation.participants
    .filter((participant) => participant.userId !== conversation.myUserId)
    .map((participant) => participant.displayName);
}

/**
 * The list, split into what you are in and what is waiting for an answer.
 *
 * ⚠ TWO LISTS, NOT ONE SORTED ONE. An invitation is not a quieter conversation
 * — it is a question addressed to you, and you cannot read a word of it until
 * you answer (`canAccessConversation` is active-only). Sorting it in among
 * threads you can open would make a row that behaves differently from every row
 * around it, and the person clicking it would be told there is nothing there.
 *
 * ⚠ ARCHIVED conversations are dropped from both. They are not deleted and the
 * rows survive; they are simply not what somebody opening chat is looking for.
 * A conversation comes back the moment it is restored.
 */
export interface SplitConversations {
  /** Ones you may read, newest activity first. */
  active: ChatConversationView[];
  /** Invitations awaiting an answer, oldest first — the queue order. */
  requests: ChatConversationView[];
}

export function splitConversations(conversations: readonly ChatConversationView[]): SplitConversations {
  const live = conversations.filter((conversation) => !conversation.archived);

  return {
    active: live.filter((conversation) => conversation.myStatus === 'active').sort(byRecency),
    /*
     * OLDEST FIRST, the opposite of the list beside it. A request queue is
     * worked through from the top, and putting the newest first means the
     * invitation somebody has been ignoring longest sinks out of sight.
     */
    requests: live.filter((conversation) => conversation.myStatus === 'invited').sort((a, b) => -byRecency(a, b)),
  };
}

/**
 * Newest activity first, with conversations nobody has spoken in last.
 *
 * ⚠ A conversation with no `lastMessageAt` has never been spoken in, and it
 * sorts to the BOTTOM rather than the top. Treating a missing timestamp as 0 is
 * accidentally correct here and worth stating: a brand-new empty group is less
 * interesting than one with a message in it from last week, and the person who
 * just created it is already looking at it.
 */
function byRecency(a: ChatConversationView, b: ChatConversationView): number {
  return time(b.lastMessageAt) - time(a.lastMessageAt) || a.id.localeCompare(b.id);
}

function time(iso: string | null): number {
  return iso ? new Date(iso).getTime() : 0;
}

/** Everything waiting for this person, across every conversation. */
export function countWaiting(conversations: readonly ChatConversationView[]): { unread: number; requests: number } {
  const { active, requests } = splitConversations(conversations);
  return {
    unread: active.reduce((total, conversation) => total + conversation.unread, 0),
    requests: requests.length,
  };
}

/**
 * THE VIEWER, AS THE RULES SEE THEM — their own participant row, narrowed from
 * the wire shape into what `domain/participant-roles.ts` accepts.
 *
 * ## ⚠ Why this is shared rather than done where it is needed
 *
 * Because it was done in one place and not the other, and the gap shipped. The
 * conversation SETTINGS page built this bridge inside
 * `useConversationSettings` and gated its "Add someone" on
 * `canInviteToConversation`; the THREAD header had no bridge, so its own "Add
 * someone" was gated on nothing but `!isDirect` — every member of a group saw a
 * button that the server refuses.
 *
 * One helper, so the question "what may this viewer do here" has one answer
 * that every surface reads.
 *
 * ⚠ `role` is NARROWED, not cast. It crosses GraphQL as a plain string, and an
 * unrecognised value falls back to `member` — the floor, and the safe direction:
 * a value this build does not know must not be read as authority it cannot
 * verify.
 *
 * @returns undefined when the viewer is not in the participant list at all,
 *   which every rule reads as "no authority" rather than throwing.
 */
export function viewerParticipant(conversation: ChatConversationView): ParticipantView | undefined {
  const mine = conversation.participants.find((one) => one.userId === conversation.myUserId);
  if (!mine) return undefined;

  return {
    conversationId: conversation.id,
    userId: mine.userId,
    status: mine.status as ParticipantView['status'],
    role: isChatParticipantRole(mine.role) ? mine.role : 'member',
  };
}

/**
 * What the viewer may do in this conversation, ready for the domain's rules.
 *
 * A convenience over `viewerParticipant` so a component reads
 * `canInviteToConversation(viewerAuthority(conversation))` rather than
 * assembling the wrapper object at each call site — which is one more place to
 * get it subtly wrong.
 */
export function viewerAuthority(conversation: ChatConversationView): ActorAuthority {
  return { participant: viewerParticipant(conversation) };
}
