import type { NoteVisibility } from '../types.js';

/**
 * Who hears about a change to a note, and as what (NOTE-PLAN §5).
 *
 * ⚠ PER SUBSCRIBER, not per workspace — the queue filters by workspace alone
 * because its events carry what a public board shows. A note's events would
 * tell a workspace that somebody's private note exists and when they write in
 * it, so each subscriber runs this over each event.
 */

/**
 * What happened to a note.
 *
 * `unshared` is its own change, not an `updated`, because it is the one event
 * that must reach people who can NO LONGER see the note (see `noteEventFor`).
 */
export type NoteChange = 'created' | 'updated' | 'shared' | 'unshared' | 'trashed' | 'restored' | 'deleted';

/** The facts a delivery decision reads. The visibility is the one AFTER the change. */
export interface NoteEventFacts {
  organizationId: string;
  workspaceId: string;
  authorId: string;
  visibility: NoteVisibility;
  change: NoteChange;
}

/** Who is listening, on which workspace. */
export interface NoteEventViewer {
  userId: string;
  organizationId: string;
  workspaceId: string;
}

/**
 * What the viewer is told:
 *
 *   changed — read the note again (it is new, edited, shared, binned or back)
 *   removed — drop it: deleted, or no longer shared with you
 *   null    — nothing; this note is not theirs to know about
 *
 * ⚠ `unshared` IS THE ONE EVENT FOR A NOTE THE VIEWER CAN NO LONGER SEE. It says
 * nothing new — they could see the note a moment ago — and without it the note
 * would sit in their index, and in their editor, until their next read.
 */
export function noteEventFor(event: NoteEventFacts, viewer: NoteEventViewer): 'changed' | 'removed' | null {
  if (event.organizationId !== viewer.organizationId || event.workspaceId !== viewer.workspaceId) return null;

  const isAuthor = event.authorId === viewer.userId;
  if (event.change === 'unshared') return isAuthor ? 'changed' : 'removed';
  if (!isAuthor && event.visibility !== 'workspace') return null;
  if (event.change === 'deleted') return 'removed';
  return 'changed';
}
