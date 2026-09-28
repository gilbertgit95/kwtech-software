/**
 * A person's own order of their notes list (the operator's decisions,
 * 2026-09-28: dragging changes only YOUR list, and the list always shows your
 * order — it never re-sorts itself by edits).
 *
 * Stored as a list of note ids on the person's `NotePreference` row. Per person,
 * as pins are: shared notes are in everybody's list, and one person dragging
 * must not reshuffle everybody else's.
 */

/**
 * The most notes one list is ordered over. A per-person order cannot be sorted
 * by a database query — it lives in another row, and Prisma cannot order notes
 * by it — so the list reads up to this many visible notes and orders them in
 * memory. Beyond it the OLDEST unplaced notes drop off the end (PLAN §12.81).
 */
export const NOTE_ORDER_MAX = 2000;

/**
 * Notes in the person's order:
 *
 *   1. notes they have NOT placed yet — new ones, and ones just shared with
 *      them — at the top, newest first, so something new is never lost at the
 *      bottom of a long list;
 *   2. then the placed ones, in their order.
 *
 * Ids in the order that are not in `notes` (deleted, unshared, filtered out)
 * are skipped.
 */
export function orderNotes<T extends { id: string; createdAt: Date }>(
  notes: readonly T[],
  order: readonly string[],
): T[] {
  const position = new Map(order.map((id, index) => [id, index]));
  const unplaced = notes
    .filter((note) => !position.has(note.id))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
  const placed = notes
    .filter((note) => position.has(note.id))
    .sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
  return [...unplaced, ...placed];
}

/**
 * The order after moving `noteId` to just after `afterId` — or to the very top
 * when `afterId` is null. `ids` is the WHOLE list as the person sees it now,
 * so the result places every note (nothing stays "unplaced" once they have
 * arranged their list).
 *
 * "Just after a neighbour" rather than "to position N" so a move made in a
 * filtered or searched list lands where it looked like it would: next to the
 * note it was dropped under, wherever that note is in the full list.
 *
 * An `afterId` not in the list, or equal to the note itself, leaves the order
 * as it was.
 */
export function moveInOrder(ids: readonly string[], noteId: string, afterId: string | null): string[] {
  if (afterId === noteId) return [...ids];
  const without = ids.filter((id) => id !== noteId);
  if (afterId === null) return [noteId, ...without];
  const at = without.indexOf(afterId);
  if (at < 0) return [...ids];
  return [...without.slice(0, at + 1), noteId, ...without.slice(at + 1)];
}
