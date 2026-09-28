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
