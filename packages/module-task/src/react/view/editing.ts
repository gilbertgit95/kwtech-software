import { normalizeTaskLine } from '../../domain/text.js';

/**
 * The title and description editor's rules — pure, and tested — so the panel
 * never loses typing and never saves what did not change.
 */

export interface TaskDraft {
  title: string;
  description: string;
}

/** What a save would send: only the fields that differ from what is stored, by the server's own rule. */
export function draftChanges(stored: TaskDraft, draft: TaskDraft): Partial<TaskDraft> | null {
  const changes: Partial<TaskDraft> = {};
  if (normalizeTaskLine(draft.title) !== stored.title && normalizeTaskLine(draft.title).length > 0) {
    changes.title = draft.title;
  }
  if (draft.description.normalize('NFC') !== stored.description) changes.description = draft.description;
  return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * What to do when the stored task arrives again (a save came back, or
 * somebody else changed it):
 *
 *   adopt  — nothing typed is unsaved: show what is stored
 *   keep   — the person is typing on top of the SAME version: leave their draft
 *   warn   — they are typing, and somebody else's save landed underneath: keep
 *            the draft and say so, so the next save's conflict is no surprise
 */
export function onStoredTask(dirty: boolean, draftVersion: number, storedVersion: number): 'adopt' | 'keep' | 'warn' {
  if (!dirty) return 'adopt';
  return storedVersion === draftVersion ? 'keep' : 'warn';
}

/** Labels as typed in one field: comma-separated. */
export function parseLabels(raw: string): string[] {
  return raw
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
}
