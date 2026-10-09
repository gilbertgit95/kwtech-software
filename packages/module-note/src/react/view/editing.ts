import { NOTE_CONFLICT_MESSAGE, NOTE_NOT_FOUND_MESSAGE, normalizeNoteTitle } from '../../domain/notes.js';
import { normalizeNoteTags } from '../../domain/tags.js';

/**
 * The editor's decisions, as pure functions: what changed, when to save, and
 * what a live event means for the note on screen (NOTE-PLAN §6).
 */

/** What a person edits. Everything else about a note is changed by an act (share, bin, pin). */
export interface NoteDraft {
  title: string;
  body: string;
  tags: readonly string[];
  color: string;
}

/**
 * The fields that differ between what the server has and what is on screen, or
 * null when nothing does. ONLY those fields are sent: a save that re-sent the
 * whole note would overwrite a colour somebody else just changed.
 *
 * ⚠ COMPARED AS THE SERVER STORES THEM (`normalizeNoteTitle`,
 * `normalizeNoteTags`, NFC). The screen keeps what was typed — "Hello " with its
 * trailing space, "#Ops" — and the server stores "Hello" and "ops". Compared
 * raw, those would be an unsaved change forever, and autosave would send them
 * every two seconds for as long as the note was open.
 */
export function editPatch(saved: NoteDraft, draft: NoteDraft): Partial<NoteDraft> | null {
  const patch: Partial<NoteDraft> = {};
  if (normalizeNoteTitle(draft.title) !== saved.title) patch.title = draft.title;
  if (draft.body.normalize('NFC') !== saved.body) patch.body = draft.body;
  if (draft.color !== saved.color) patch.color = draft.color;
  if (normalizeNoteTags(draft.tags).join('\n') !== saved.tags.join('\n')) patch.tags = draft.tags;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** How the open note is shown: to be read, or with its fields open for writing. */
export type NoteMode = 'read' | 'edit';

/**
 * The mode a note OPENS in. A note is opened to be read far more often than to
 * be changed, and opened straight into its fields a stray key writes into it
 * and autosaves (the operator, 2026-10-09). So it opens for reading, and Edit
 * is a press.
 *
 * ⚠ EXCEPT A NOTE WITH NOTHING IN IT, which opens for writing: that is the
 * note "New note" just made, there is nothing to read, and making somebody
 * press Edit on a blank page they asked for is a press for nothing.
 */
export function noteOpensIn(note: Pick<NoteDraft, 'title' | 'body'>): NoteMode {
  return note.title.trim() === '' && note.body.trim() === '' ? 'edit' : 'read';
}

/**
 * ⚠ THE THROTTLE BUCKET IS SHARED. Every browser reaches the API through the
 * Next server, so every person behind it shares one 600-a-minute bucket
 * (PLAN §12.69). A save per keystroke — or per 800 ms — would throttle the
 * whole app once a handful of people type at once.
 */
/** Save this long after the last keystroke. */
export const AUTOSAVE_IDLE_MS = 2_000;
/** While typing without pause, save at most this often. */
export const AUTOSAVE_MAX_WAIT_MS = 5_000;

/**
 * How long until the next autosave should run — 0 for "now".
 *
 * Whichever comes first: a pause of `AUTOSAVE_IDLE_MS` after the last edit, or
 * `AUTOSAVE_MAX_WAIT_MS` after the first edit not yet saved.
 */
export function autosaveDelay(now: number, lastEditAt: number, firstUnsavedEditAt: number): number {
  const due = Math.min(lastEditAt + AUTOSAVE_IDLE_MS, firstUnsavedEditAt + AUTOSAVE_MAX_WAIT_MS);
  return Math.max(0, due - now);
}

/** An event as the socket delivers it. */
export interface NoteEventView {
  kind: string;
  noteId: string | null;
  version: number | null;
  actorId: string | null;
}

/** The note on screen, as far as an event is concerned. */
export interface OpenNoteState {
  noteId: string | null;
  /** The version the editor's text was based on. */
  version: number;
  /** Unsaved changes on screen. */
  dirty: boolean;
  /** A save is in flight. */
  saving: boolean;
}

/**
 * What to do with one event.
 *
 *   index — read the list again
 *   open  — for the note on screen:
 *     none    nothing (another note, or our own save coming back)
 *     reload  read it again and show it: nothing on screen would be lost
 *     check   read it again and compare versions (after a reconnect)
 *     stale   somebody else changed it while we have unsaved text: ASK
 *     gone    it was deleted or unshared: rescue unsaved text, or close
 *
 * ⚠ LIVE UPDATES NEVER REPLACE TEXT BEING EDITED. With unsaved text the answer
 * is `stale`, never `reload`.
 *
 * ⚠ WHILE A SAVE IS IN FLIGHT, a change to the open note is ignored: its
 * outcome is authoritative. It is either our own save coming back, or somebody
 * else's that our save will now conflict with — and the conflict says so.
 */
export function planNoteEvent(
  event: NoteEventView,
  open: OpenNoteState,
): { index: boolean; open: 'none' | 'reload' | 'check' | 'stale' | 'gone' } {
  if (event.kind === 'sync') return { index: true, open: open.noteId ? 'check' : 'none' };

  const isOpen = open.noteId !== null && event.noteId === open.noteId;
  if (!isOpen) return { index: true, open: 'none' };
  if (event.kind === 'removed') return { index: true, open: 'gone' };
  if (open.saving) return { index: true, open: 'none' };
  // An event at or below the version on screen says nothing new.
  if (event.version !== null && event.version <= open.version) return { index: true, open: 'none' };
  return { index: true, open: open.dirty ? 'stale' : 'reload' };
}

/**
 * Which of the two refusals the editor acts on this error is, if either. The
 * API's messages are compared EXACTLY: production strips an error's reason, and
 * these two messages are exported for this comparison (`domain/notes.ts`).
 */
export function saveFailure(error: unknown): 'conflict' | 'gone' | 'other' {
  const message = error instanceof Error ? error.message : '';
  if (message === NOTE_CONFLICT_MESSAGE) return 'conflict';
  if (message === NOTE_NOT_FOUND_MESSAGE) return 'gone';
  return 'other';
}

/** The title a rescued copy gets, so it is not mistaken for the note it came from. */
export function copyTitle(title: string): string {
  const base = title.trim() || 'Untitled';
  return `${base} (my copy)`;
}

/**
 * Tags as typed in one field, comma-separated, into a list. The server
 * normalises them; this only splits.
 */
export function parseTagField(field: string): string[] {
  return field
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}
