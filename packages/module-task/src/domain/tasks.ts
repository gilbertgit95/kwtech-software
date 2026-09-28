import type { TaskPriority, TaskRefusal } from '../types.js';
import { prepareTaskBlock, prepareTaskLine } from './text.js';

/**
 * A task's own text, its priority, its checklist and its comments, and the
 * version check that stops a stale save overwriting a newer one.
 */

/**
 * ⚠ THE TWO MESSAGES THE APP MATCHES ON. `formatError` strips `extensions` in
 * production, so a client never sees a refusal's reason — only its message
 * (backend rules, "Known gap"). These change what the app DOES, so they are
 * exported and compared exactly; every other refusal is only shown.
 */
export const TASK_NOT_FOUND_MESSAGE = 'That board or task does not exist, or it is not shared with you';

/** A save based on an older version. The app reads the task again and offers reload or overwrite. */
export const TASK_CONFLICT_MESSAGE = 'Somebody else saved this task while you were editing it';

/** In code points. */
export const TASK_TITLE_MAX = 200;
export const TASK_DESCRIPTION_MAX = 20_000;
export const TASK_CHECKLIST_ITEM_MAX = 200;
export const TASK_COMMENT_MAX = 4000;

/** How many checklist items one task may have. Past fifty, it is a board of its own. */
export const TASK_CHECKLIST_MAX = 50;

/** How many comments one task keeps. A cap on one row's thread, not on talk. */
export const TASK_COMMENTS_MAX = 500;

/** A title as stored, or why it is refused. Never empty: a card with no title is a blank rectangle. */
export function prepareTaskTitle(raw: string): { title: string } | { refused: TaskRefusal } {
  const title = prepareTaskLine(raw, TASK_TITLE_MAX);
  return title === null ? { refused: 'invalid_title' } : { title };
}

/** A description as stored, or why it is refused. Empty is allowed: most tasks are only a title. */
export function prepareTaskDescription(raw: string): { description: string } | { refused: TaskRefusal } {
  const description = prepareTaskBlock(raw, TASK_DESCRIPTION_MAX, { allowEmpty: true });
  return description === null ? { refused: 'invalid_description' } : { description };
}

/** One checklist item's text as stored, or why it is refused. */
export function prepareChecklistText(raw: string): { text: string } | { refused: TaskRefusal } {
  const text = prepareTaskLine(raw, TASK_CHECKLIST_ITEM_MAX);
  return text === null ? { refused: 'invalid_checklist_item' } : { text };
}

/**
 * A comment as stored, or why it is refused. Plain text kept as typed
 * (decision 18); the app makes links clickable, and nothing is rendered as
 * markup, so a comment can never inject anything.
 */
export function prepareCommentBody(raw: string): { body: string } | { refused: TaskRefusal } {
  const body = prepareTaskBlock(raw, TASK_COMMENT_MAX);
  return body === null ? { refused: 'invalid_comment' } : { body };
}

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const satisfies readonly TaskPriority[];

/** A priority as it arrives over the wire — a string — narrowed. */
export function isTaskPriority(value: unknown): value is TaskPriority {
  return (TASK_PRIORITIES as readonly unknown[]).includes(value);
}

/**
 * Whether a save based on `expectedVersion` may land on a task now at
 * `currentVersion`. Only the title and description are versioned (decision
 * 17): a card dragged across the board must never conflict with somebody
 * typing its description.
 *
 * ⚠ CHECKED AFTER ACCESS, always. A `conflict` for a task on a board the caller
 * cannot open would confirm it exists.
 *
 * The service does not trust this alone: the write is conditional on the
 * version too (`where: { id, version }`), so two saves that both pass this
 * check cannot both land.
 */
export function checkTaskVersion(expectedVersion: number, currentVersion: number): TaskRefusal | null {
  return expectedVersion === currentVersion ? null : 'conflict';
}

/**
 * `completedAt` after a task lands in a column: set when it ENTERS a done
 * column, kept while it moves between done columns, cleared when it leaves them
 * (decision 6).
 */
export function completedAtAfterMove(current: Date | null, toDoneColumn: boolean, now: Date): Date | null {
  if (!toDoneColumn) return null;
  return current ?? now;
}
