import type { NoteRefusal } from '../types.js';

/**
 * What a note's title and body may hold, and the version check that stops a
 * stale save overwriting a newer one.
 */

/**
 * ⚠ THE TWO MESSAGES THE APP MATCHES ON. `formatError` strips `extensions` in
 * production, so a client never sees a refusal's reason — only its message
 * (backend rules, "Known gap"). These two change what the app DOES, so they are
 * exported from here and compared exactly; every other refusal is only shown.
 */
export const NOTE_NOT_FOUND_MESSAGE = 'That note does not exist, or it is not shared with you';

/** A save based on an older version. The app reads the note again and offers reload, overwrite or a copy. */
export const NOTE_CONFLICT_MESSAGE = 'Somebody else saved this note while you were editing it';

/** In code points. A title is a line in the index, not a paragraph. */
export const NOTE_TITLE_MAX = 200;

/**
 * In code points. Generous for a note, and a ceiling on what one autosave sends
 * through a throttle bucket shared by everyone behind the Next server (§12.69).
 */
export const NOTE_BODY_MAX = 100_000;

/**
 * Control and invisible formatting characters, refused in a TITLE.
 *
 * A title is what other members see in a shared index. A right-to-left override
 * makes it read as something else, and a zero-width space makes two titles that
 * look the same different — the queue's `prepareDisplayText` reasoning. The
 * same cost: an emoji sequence with a zero-width joiner is refused.
 */
const CONTROL_OR_INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * A title as it is stored and compared: NFC, whitespace runs as one space,
 * trimmed. Exported because the editor must compare what it would SEND by the
 * same rule — typing "Hello " is not an unsaved change once "Hello" is stored,
 * or autosave would resend it forever.
 */
export function normalizeNoteTitle(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/**
 * The title as it will be stored, or why it is refused.
 *
 * NFC-normalised, whitespace runs collapsed to one space, trimmed — the collapse
 * first, so a pasted newline becomes a space rather than a refusal. EMPTY IS
 * ALLOWED: a note is often started by its body, and the index shows the first
 * line instead (`noteDisplayTitle`).
 */
export function prepareNoteTitle(raw: string): { title: string } | { refused: NoteRefusal } {
  const title = normalizeNoteTitle(raw);
  if (CONTROL_OR_INVISIBLE.test(title)) return { refused: 'invalid_title' };
  if ([...title].length > NOTE_TITLE_MAX) return { refused: 'invalid_title' };
  return { title };
}

/**
 * The body as it will be stored, or why it is refused.
 *
 * NFC-normalised and otherwise KEPT AS TYPED: it is Markdown, where newlines,
 * indentation and trailing spaces all mean something.
 *
 * ⚠ NUL IS REFUSED, not stripped. Postgres `text` cannot store `\u0000` at all,
 * so letting it through fails the write with a driver error instead of a
 * reason; stripping it would store something other than what was sent.
 */
export function prepareNoteBody(raw: string): { body: string } | { refused: NoteRefusal } {
  const body = raw.normalize('NFC');
  if (body.includes('\u0000')) return { refused: 'invalid_body' };
  if ([...body].length > NOTE_BODY_MAX) return { refused: 'invalid_body' };
  return { body };
}

/** How long a title shown in the index may be before it is cut. */
const DISPLAY_TITLE_MAX = 80;

/**
 * What the index calls a note: its title, else the first line of the body with
 * its Markdown markers dropped, else "Untitled".
 */
export function noteDisplayTitle(note: { title: string; body: string }): string {
  if (note.title) return note.title;

  const firstLine = note.body
    .split('\n')
    .map((line) => line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|>\s*|\d+[.)]\s+)/u, '').trim())
    .find((line) => line.length > 0);
  if (!firstLine) return 'Untitled';

  const points = [...firstLine];
  if (points.length <= DISPLAY_TITLE_MAX) return firstLine;
  return `${points.slice(0, DISPLAY_TITLE_MAX - 1).join('')}…`;
}

/** In code points: enough for a few lines on a sticky note, never the whole body. */
export const NOTE_PREVIEW_MAX = 240;

/**
 * The start of a body as PLAIN text, stored beside it so the index never reads
 * the body itself: Markdown markers dropped, whitespace (newlines included)
 * collapsed, cut at `NOTE_PREVIEW_MAX` with an ellipsis.
 *
 * ⚠ A PREVIEW, NOT A RENDERING. It only has to read sensibly in two or three
 * lines; links keep their text and lose their address, and anything subtler is
 * left as typed.
 */
export function notePreview(body: string): string {
  const text = body
    .split('\n')
    .map((line) => line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|>\s*|\d+[.)]\s+|```.*$)/u, ''))
    .join(' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\*\*|__|~~|[*`]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  const points = [...text];
  if (points.length <= NOTE_PREVIEW_MAX) return text;
  return `${points.slice(0, NOTE_PREVIEW_MAX - 1).join('')}…`;
}

/**
 * Whether a save based on `expectedVersion` may land on a note now at
 * `currentVersion`.
 *
 * ⚠ CHECKED AFTER VISIBILITY, always. A `conflict` for a note the caller cannot
 * see would confirm it exists (NOTE-PLAN §5).
 *
 * The service does not trust this alone: the write is conditional on the
 * version too (`where: { id, version }`), so two saves that both pass this
 * check cannot both land.
 */
export function checkNoteVersion(expectedVersion: number, currentVersion: number): NoteRefusal | null {
  if (expectedVersion !== currentVersion) return 'conflict';
  return null;
}
