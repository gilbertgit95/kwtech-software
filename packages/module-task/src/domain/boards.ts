import type { TaskColumnFacts, TaskRefusal } from '../types.js';
import { normalizeTaskLine, prepareTaskLine } from './text.js';

/**
 * A board and its columns (TASK-PLAN decisions 6 and 7).
 *
 * Columns are the board OWNER's to make: add, rename, reorder, remove, and
 * mark which of them mean "finished". Nothing about a column is fixed by the
 * module except the caps and the two columns a board can never be without.
 */

/** In code points. */
export const TASK_BOARD_NAME_MAX = 80;
export const TASK_COLUMN_NAME_MAX = 40;

/** How many columns one board may have. Past a dozen, a board is a spreadsheet. */
export const TASK_COLUMNS_MAX = 12;

/**
 * What a new board is offered, and what the creator edits before saving
 * (decision 6). Not stored anywhere as a template: a board is created with
 * whatever columns the creator sent, and these are only the form's start.
 */
export const TASK_DEFAULT_COLUMNS: readonly { name: string; done: boolean }[] = [
  { name: 'To do', done: false },
  { name: 'Doing', done: false },
  { name: 'Done', done: true },
];

/** A board name as stored, or why it is refused. Never empty: the switcher lists boards by name. */
export function prepareBoardName(raw: string): { name: string } | { refused: TaskRefusal } {
  const name = prepareTaskLine(raw, TASK_BOARD_NAME_MAX);
  return name === null ? { refused: 'invalid_name' } : { name };
}

/**
 * What makes two column names the same: the stored name, lower-cased. "Done"
 * and "done " on one board are one column in anybody's reading, so the database
 * keeps them unique by this (`@@unique([boardId, nameKey])`).
 */
export function columnNameKey(name: string): string {
  return normalizeTaskLine(name).toLocaleLowerCase('en');
}

/** A column name as stored, or why it is refused. */
export function prepareColumnName(raw: string): { name: string } | { refused: TaskRefusal } {
  const name = prepareTaskLine(raw, TASK_COLUMN_NAME_MAX);
  return name === null ? { refused: 'invalid_column' } : { name };
}

/**
 * The columns a board is CREATED with, as stored, or why they are refused.
 *
 * At least one column, at most `TASK_COLUMNS_MAX`, names unique ignoring case.
 * ⚠ A board with no done column is allowed — some boards are only a queue of
 * work — but then nothing on it is ever finished, so no task is overdue-exempt
 * and none is counted done. Removing the LAST done column later is refused
 * (`checkRemoveColumn`), because that silently un-finishes every finished task.
 */
export function prepareInitialColumns(
  raw: readonly { name: string; done: boolean }[],
): { columns: readonly { name: string; done: boolean }[] } | { refused: TaskRefusal } {
  if (raw.length === 0) return { refused: 'last_column' };
  if (raw.length > TASK_COLUMNS_MAX) return { refused: 'too_many_columns' };
  const columns: { name: string; done: boolean }[] = [];
  const keys = new Set<string>();
  for (const entry of raw) {
    const prepared = prepareColumnName(entry.name);
    if ('refused' in prepared) return prepared;
    const key = columnNameKey(prepared.name);
    if (keys.has(key)) return { refused: 'duplicate_column' };
    keys.add(key);
    columns.push({ name: prepared.name, done: entry.done });
  }
  return { columns };
}

/** Adding one more column: the cap and the name, against the board's current columns. */
export function checkAddColumn(existing: readonly { name: string }[], name: string): TaskRefusal | null {
  if (existing.length >= TASK_COLUMNS_MAX) return 'too_many_columns';
  return checkColumnNameFree(existing, name, null);
}

/** Whether `name` is free on the board, ignoring the column being renamed. */
export function checkColumnNameFree(
  existing: readonly { id?: string; name: string }[],
  name: string,
  renamingId: string | null,
): TaskRefusal | null {
  const key = columnNameKey(name);
  const clash = existing.some((column) => column.id !== renamingId && columnNameKey(column.name) === key);
  return clash ? 'duplicate_column' : null;
}

/**
 * Removing a column, and where its tasks go (decision 7).
 *
 * ⚠ A BOARD ALWAYS KEEPS ONE COLUMN, and a board that HAS a done column keeps
 * one: removing the last done column would silently turn every finished task
 * back into unfinished work. Unmark or remove it by adding another first.
 *
 * `destinationId` is where the removed column's tasks go. Required only when it
 * has tasks; it must be another column on the same board.
 */
export function checkRemoveColumn(
  columns: readonly TaskColumnFacts[],
  columnId: string,
  destinationId: string | null,
  taskCount: number,
): TaskRefusal | null {
  const column = columns.find((candidate) => candidate.id === columnId);
  if (!column) return 'not_found';
  if (columns.length <= 1) return 'last_column';
  if (column.done && columns.filter((candidate) => candidate.done).length === 1) return 'last_done_column';
  if (taskCount === 0) return null;
  if (destinationId === null || destinationId === columnId) return 'invalid_destination';
  if (!columns.some((candidate) => candidate.id === destinationId)) return 'invalid_destination';
  return null;
}

/**
 * Unmarking a column as done follows the removal rule: the board may not lose
 * its last done column that way either.
 */
export function checkSetColumnDone(
  columns: readonly TaskColumnFacts[],
  columnId: string,
  done: boolean,
): TaskRefusal | null {
  const column = columns.find((candidate) => candidate.id === columnId);
  if (!column) return 'not_found';
  if (!done && column.done && columns.filter((candidate) => candidate.done).length === 1) return 'last_done_column';
  return null;
}
