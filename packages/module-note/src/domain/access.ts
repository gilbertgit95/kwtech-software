import type { NoteAccessFacts, NoteRefusal } from '../types.js';

/**
 * Who may do what to a note (NOTE-PLAN decisions 1, 11, 12 and §3).
 *
 * These decide over ONE NOTE AND ONE PERSON. Whether the person holds
 * `note:read` or `note:write` in the workspace is the guard's question, asked
 * before any of this runs; these answer what that key allows on THIS note.
 *
 * ⚠ ORDER MATTERS IN EVERY CHECK: visibility first. A refusal that is anything
 * but `not_found` tells the caller the note exists, so no other reason may be
 * given for a note they cannot see.
 */

/**
 * Whether this person may see the note at all.
 *
 * ⚠ NO OVERRIDE. Not `note:manage_all`, not a super admin: a private note is its
 * author's alone (decision 12), so this takes no key and no role.
 *
 * A trashed note is still SEEN by whoever could see it live: the Trash tab
 * shows a shared note somebody binned, so the others can ask for it back.
 */
export function canSeeNote(note: Pick<NoteAccessFacts, 'authorId' | 'visibility'>, userId: string): boolean {
  if (note.authorId === userId) return true;
  return note.visibility === 'workspace';
}

/**
 * Editing the title, body, tags or colour, and restoring a revision.
 *
 * Anybody who can see a shared note may edit it (decision 11) — the revisions
 * kept when somebody else edits are what make that safe (`shouldKeepRevision`).
 * A note in the trash is read-only: restore it first, or an edit lands on a
 * note nobody is looking at.
 */
export function checkEditNote(note: NoteAccessFacts, userId: string): NoteRefusal | null {
  if (!canSeeNote(note, userId)) return 'not_found';
  if (note.trashedAt !== null) return 'in_trash';
  return null;
}

/**
 * Sharing and unsharing: the AUTHOR's alone.
 *
 * ⚠ Unsharing takes the note away from everybody else, including what they
 * wrote in it. Letting anyone else do it would let an editor capture a team's
 * note as their own private one — and they are not its author, so it would not
 * even be theirs.
 */
export function checkShareNote(note: NoteAccessFacts, userId: string): NoteRefusal | null {
  if (!canSeeNote(note, userId)) return 'not_found';
  if (note.authorId !== userId) return 'not_author';
  if (note.trashedAt !== null) return 'in_trash';
  return null;
}

/** Pinning is the person's own row; seeing the note is enough, trashed or not. */
export function checkPinNote(note: NoteAccessFacts, userId: string): NoteRefusal | null {
  if (!canSeeNote(note, userId)) return 'not_found';
  return null;
}

/** The three acts that throw a note away or bring it back. */
export type NoteBinAct = 'trash' | 'restore' | 'delete_forever';

/**
 * Whether this person may trash, restore or delete forever — or whether it
 * depends on `note:manage_all`, which only the host can answer.
 *
 * A PLAN, not a boolean, because the answer may need a port: the service asks
 * `NoteAccessCheck` only on `needs_manage_all`, which keeps a permission load
 * off the common case of somebody tidying their own notes.
 *
 * ⚠ `needs_manage_all` ONLY FOR A SHARED NOTE. Somebody else's private note is
 * `not_found` before the key is ever consulted: `manage_all` throws away shared
 * work, and cannot even learn that private work exists.
 *
 * ⚠ DELETE FOREVER ONLY FROM THE TRASH. One act that cannot be undone should
 * never be one click from a live note (NOTE-PLAN decision 14).
 */
export type NoteBinPlan = { kind: 'allowed' } | { kind: 'needs_manage_all' } | { kind: 'refused'; reason: NoteRefusal };

export function planNoteBinAct(note: NoteAccessFacts, userId: string, act: NoteBinAct): NoteBinPlan {
  if (!canSeeNote(note, userId)) return { kind: 'refused', reason: 'not_found' };

  const stateRefusal = checkBinState(note, act);
  if (stateRefusal) return { kind: 'refused', reason: stateRefusal };

  if (note.authorId === userId) return { kind: 'allowed' };
  return { kind: 'needs_manage_all' };
}

function checkBinState(note: Pick<NoteAccessFacts, 'trashedAt'>, act: NoteBinAct): NoteRefusal | null {
  switch (act) {
    case 'trash':
      return note.trashedAt === null ? null : 'in_trash';
    case 'restore':
    case 'delete_forever':
      return note.trashedAt === null ? 'not_in_trash' : null;
  }
}

/**
 * Whether a save should keep the text it replaces as a revision.
 *
 * Only for a SHARED note saved by somebody OTHER than whoever saved it last.
 * That is the edit that can destroy another person's work — blanking a shared
 * note is otherwise a delete that needs no key and leaves no trace. A person
 * autosaving their own typing every few seconds is not, and keeping those would
 * fill the table with one revision per pause.
 */
export function shouldKeepRevision(
  note: Pick<NoteAccessFacts, 'visibility'> & { updatedById: string },
  editorId: string,
): boolean {
  if (note.visibility !== 'workspace') return false;
  return note.updatedById !== editorId;
}

/** How many revisions a note keeps. The oldest goes when one more is written. */
export const NOTE_REVISIONS_KEPT = 20;
