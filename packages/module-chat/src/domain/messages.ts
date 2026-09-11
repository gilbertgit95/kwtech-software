import type { MessageView, ParticipantView } from '../types.js';
import { canAccessConversation } from './participation.js';

/**
 * What a message may contain, who may change it, and what counts as unread.
 */

/**
 * ⚠ COUNTED IN CODE POINTS, not `String.length`.
 *
 * `.length` counts UTF-16 units, so an emoji is two and a flag is four. A cap of
 * 4000 units would cut a message of 1000 flags — and the first report of it
 * would be "chat silently truncates my message", from the users most likely to
 * use emoji.
 *
 * Four thousand is well past any message somebody types and well short of a
 * paste that belongs in a document. Postgres `text` is unbounded, so without a
 * cap here there is no cap anywhere.
 */
export const MAX_BODY_CODE_POINTS = 4000;

/**
 * ⚠ THE CEILING ON A PAGE, not the default.
 *
 * An unbounded page size is a request for a hundred thousand rows, from anybody
 * who can type a number into a query. The default is the client's business; this
 * is the most the server will serve whatever it asks for.
 */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 30;

export type BodyRefusal = 'empty' | 'too_long';

/**
 * The body as it will be stored, or why it is refused.
 *
 * Trimmed, because a message of spaces is an empty message with extra steps —
 * and because the trim has to happen BEFORE the length check or trailing
 * whitespace can push a legal message over the cap.
 *
 * ⚠ PLAIN TEXT. No markdown and NO AUTO-LINKING: auto-linking is a phishing
 * vector the moment display text and href may differ, and bodies are rendered
 * into other people's browsers — a far larger surface than the free-text
 * availability field this design already refused. Markdown later is additive;
 * removing it is not.
 */
export function prepareBody(raw: string): { body: string } | { refused: BodyRefusal } {
  const body = raw.trim();
  if (body.length === 0) return { refused: 'empty' };
  if ([...body].length > MAX_BODY_CODE_POINTS) return { refused: 'too_long' };
  return { body };
}

/** Clamps whatever a caller asked for into what the server will serve. */
export function pageSize(requested?: number | null): number {
  if (requested == null || !Number.isInteger(requested) || requested < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(requested, MAX_PAGE_SIZE);
}

/**
 * May this person edit this message?
 *
 * AUTHOR ONLY. Moderation deletes; it does not rewrite what somebody said, and
 * an edit that could be made by anybody else is a forgery with the original
 * author's name on it.
 *
 * ⚠ And an edit NEVER TOUCHES `createdAt` — see `editPatch`.
 */
export function canEditMessage(message: MessageView, actorId: string): boolean {
  if (message.kind !== 'user') return false;
  if (message.deletedAt != null) return false;
  return message.authorId === actorId;
}

/**
 * The columns an edit writes, and — by omission — the one it must not.
 *
 * ⚠ `createdAt` IS ABSENT ON PURPOSE. The thread is ordered by keyset on
 * `(createdAt, id)`, so touching it makes an edited message JUMP POSITION
 * mid-conversation for everybody reading. Returning the patch from here rather
 * than building it at the call site means there is one object to review, and it
 * cannot quietly grow the field.
 */
export function editPatch(body: string, now: Date): { body: string; editedAt: Date } {
  return { body, editedAt: now };
}

export type DeleteRefusal = 'not_a_participant' | 'already_deleted' | 'not_yours';

/**
 * Why a delete is refused, or `null` when it may proceed.
 *
 * Two ways it may proceed, and they are different acts:
 *
 *   your own      no key needed beyond `chat:send`'s world — removing what you
 *                 said is not a power over anybody else.
 *   ⚠ moderation  `chat:moderate`, and ONLY inside a conversation the actor
 *                 participates in. That is §12.42 holding: there is no
 *                 read-any-conversation key, so there is no delete-anywhere one
 *                 either. It is recorded on the tombstone — `deletedById` — for
 *                 the question that gets asked afterwards.
 */
export function refuseDelete(
  message: MessageView,
  actor: ParticipantView | null | undefined,
  options: { mayModerate: boolean },
): DeleteRefusal | null {
  if (!canAccessConversation(actor)) return 'not_a_participant';
  if (message.deletedAt != null) return 'already_deleted';
  if (message.authorId === actor.userId) return null;
  return options.mayModerate ? null : 'not_yours';
}

/**
 * Does this message add to somebody's unread badge?
 *
 * Three exclusions, each of which is a badge that would otherwise be wrong:
 *
 *   your own         you know what you sent.
 *   ⚠ system         "X left the conversation" is not addressed to anybody, and
 *                    a badge for it makes a group people are leaving look busy.
 *   deleted          a tombstone holds its place in the keyset ordering, but
 *                    counting one means a badge pointing at nothing to read.
 *
 * The POSITION test — after `lastReadMessageId` — is the caller's, because it is
 * a keyset comparison the database does far better than this can. This is the
 * per-message half of the rule.
 */
export function countsAsUnread(message: MessageView, viewerId: string): boolean {
  if (message.kind !== 'user') return false;
  if (message.deletedAt != null) return false;
  return message.authorId !== viewerId;
}
