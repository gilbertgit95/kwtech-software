/**
 * Where the notes list goes, in a box of any size.
 *
 * The list can be collapsed to a thin bar and expanded again, at every width
 * (the operator's request, 2026-09-28: a narrow box used to hide it with only a
 * "‹ Index" link to get it back).
 *
 *   beside  — a column next to the note (a wide box)
 *   overlay — slid out OVER the note (a narrow box with a note open: beside it,
 *             both would be too cramped to read)
 *   full    — the whole box (a narrow box and no note open: there is nothing
 *             else to show)
 *   hidden  — collapsed to the bar
 */
export type NoteIndexLayout = 'beside' | 'overlay' | 'full' | 'hidden';

/**
 * Narrower than this, the list and the note do not fit side by side. In rem, so
 * it follows the viewer's text size; the same width as Tailwind's `@2xl`
 * container, which the rest of the app lays out by.
 */
export const NOTE_NARROW_REM = 42;

/**
 * @param choice what the person last chose with the bar — `true` shown, `false`
 * hidden — or `null` for the automatic answer: shown when wide, and when narrow
 * only while no note is open.
 */
export function noteIndexLayout(input: {
  narrow: boolean;
  noteOpen: boolean;
  choice: boolean | null;
}): NoteIndexLayout {
  const shown = input.choice ?? (!input.narrow || !input.noteOpen);
  if (!shown) return 'hidden';
  if (!input.narrow) return 'beside';
  return input.noteOpen ? 'overlay' : 'full';
}

/**
 * The choice to keep after a note is picked from the list. Narrow, the overlay
 * gets out of the way (back to automatic, which hides it while a note is open);
 * wide, the person's choice stands.
 */
export function choiceAfterOpening(narrow: boolean, choice: boolean | null): boolean | null {
  return narrow ? null : choice;
}

/**
 * The note to open by itself when the app has just loaded its list, or null
 * for none: the first in the list's order (pinned first), so the app opens on
 * something to read and not on "Choose a note from the index" (the operator,
 * 2026-10-09).
 *
 * Null when a note is already open: the person was quicker than the list, and
 * what they picked or made is not replaced.
 *
 * ⚠ NULL IN A NARROW BOX. There the list and a note do not fit side by side,
 * and an open note hides the list (`noteIndexLayout`): opening one unasked
 * would put the list away before anybody saw it.
 */
export function noteToOpenOnLoad(input: {
  ordered: readonly { id: string }[];
  openId: string | null;
  narrow: boolean;
}): string | null {
  if (input.narrow || input.openId !== null) return null;
  return input.ordered[0]?.id ?? null;
}

/**
 * The note before or after the open one, in the list's order (pinned first) —
 * what the page-turn buttons open while the list is collapsed.
 *
 *   { id }       — open this one
 *   'load_more'  — the open note is the last one loaded and more exist: load
 *                  the next page, then ask again
 *   null         — there is none (the first note, or the very last)
 *
 * A note no longer in the list (it was unshared, or filtered out) turns to the
 * list's first note going forward and has nothing before it.
 */
export function adjacentNote(
  ordered: readonly { id: string }[],
  openId: string | null,
  direction: 'previous' | 'next',
  hasMore: boolean,
): { id: string } | 'load_more' | null {
  const at = openId === null ? -1 : ordered.findIndex((note) => note.id === openId);
  if (direction === 'previous') {
    const before = at > 0 ? ordered[at - 1] : undefined;
    return before ? { id: before.id } : null;
  }
  const after = ordered[at + 1];
  if (after) return { id: after.id };
  return hasMore && at >= 0 ? 'load_more' : null;
}

/**
 * A drag's result, for one section of the list (pinned, or the rest): the
 * section's ids with `activeId` moved to where `overId` was, and the note it
 * now follows — what `moveNote` is told. Null when nothing moved.
 *
 * ⚠ `afterId` is the neighbour WITHIN THE SECTION, or null at its top. Pinned
 * notes are shown apart from the rest whatever the stored order, so "the top
 * of the section" is safely "the top of the whole list".
 */
export function dropResult(
  ids: readonly string[],
  activeId: string,
  overId: string,
): { ids: string[]; afterId: string | null } | null {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return null;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  const at = next.indexOf(activeId);
  return { ids: next, afterId: at > 0 ? (next[at - 1] ?? null) : null };
}

/** Ctrl+Shift+↑ / ↓ (← / → on the sticky board) moves the focused note one place — the keyboard's drag. */
export function keyboardMove(ids: readonly string[], noteId: string, step: -1 | 1): ReturnType<typeof dropResult> {
  const at = ids.indexOf(noteId);
  const over = ids[at + step];
  return at < 0 || over === undefined ? null : dropResult(ids, noteId, over);
}
