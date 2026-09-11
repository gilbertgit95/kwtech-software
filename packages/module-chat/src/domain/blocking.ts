import type { BlockView } from '../types.js';

/**
 * NOBODY COULD REFUSE CONTACT — the hole this file closes.
 *
 * Chat is app level and the directory takes an email, so anyone who knows your
 * address could open a DM, and declining only let them re-invite. A harassment
 * vector with no remedy, and `chat:moderate` does not help: §12.42 deliberately
 * makes moderation require participation, so the PLATFORM has none either. This
 * is the user's own.
 */

/**
 * Is contact between these two blocked, in EITHER direction?
 *
 * Both directions, deliberately. A block is not "I will not see you", it is
 * "we are not in contact" — and a one-way reading means the blocker can still
 * open a conversation with somebody they have blocked, which is the reverse of
 * what they asked for.
 */
export function isContactBlocked(blocks: readonly BlockView[], userA: string, userB: string): boolean {
  return blocks.some(
    (block) =>
      (block.blockerId === userA && block.blockedId === userB) ||
      (block.blockerId === userB && block.blockedId === userA),
  );
}

/** Everyone in `candidates` who can still be reached by `actor`. */
export function reachable(
  blocks: readonly BlockView[],
  actor: string,
  candidates: readonly string[],
): readonly string[] {
  return candidates.filter((candidate) => !isContactBlocked(blocks, actor, candidate));
}

/**
 * ⚠ A BLOCKED SENDER GETS THE SAME ANSWER AS AN UNKNOWN ADDRESS.
 *
 * One message, one status, the same timing — or the block becomes a
 * NOTIFICATION that you have been blocked, which tells the blocked person
 * exactly what they wanted to know and hands them the next move.
 *
 * Named as a constant rather than written at each call site so the two paths
 * cannot drift into two different sentences, which is how this leaks: "no such
 * user" here and "you cannot message this person" there is the whole disclosure.
 */
export const CONTACT_REFUSED_MESSAGE = 'No account matches that address.';
