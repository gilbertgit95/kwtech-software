import { canOpenBoard } from '../domain/access.js';
import { TaskWriteError, taskNotFound } from './task.errors.js';
import type { InScope, TaskBoardRow, TaskRow, TaskTransaction } from './task.repository.js';

/**
 * Finding a board or task the way EVERY service must: by id AND scope, then
 * `canOpenBoard`, with ONE answer for "no such thing" and "not yours to see".
 *
 * In one file so there is one way to do it. A service that looked a task up by
 * id alone, or answered differently for a private board, would reopen the
 * existence oracle the domain was written to close.
 */

export type TaskScope = InScope;

type Reader = Pick<TaskTransaction, 'taskBoard' | 'task'>;

/** A board this person may open, or `not_found`. */
export async function loadBoard(
  client: Reader,
  scope: TaskScope,
  boardId: string,
  viewerId: string,
): Promise<TaskBoardRow> {
  const board = await client.taskBoard.findFirst({ where: { ...scope, id: boardId } });
  if (!board || !canOpenBoard(board, viewerId)) throw taskNotFound();
  return board;
}

/** A task and its board, both in scope, on a board this person may open — or `not_found`. */
export async function loadTask(
  client: Reader,
  scope: TaskScope,
  taskId: string,
  viewerId: string,
): Promise<{ task: TaskRow; board: TaskBoardRow }> {
  const task = await client.task.findFirst({ where: { ...scope, id: taskId } });
  if (!task) throw taskNotFound();
  const board = await client.taskBoard.findFirst({ where: { ...scope, id: task.boardId } });
  if (!board || !canOpenBoard(board, viewerId)) throw taskNotFound();
  return { task, board };
}

/** The same lookups, answering null instead of throwing — for queries, which return null. */
export async function findBoard(
  client: Reader,
  scope: TaskScope,
  boardId: string,
  viewerId: string,
): Promise<TaskBoardRow | null> {
  const board = await client.taskBoard.findFirst({ where: { ...scope, id: boardId } });
  return board && canOpenBoard(board, viewerId) ? board : null;
}

export async function findTask(
  client: Reader,
  scope: TaskScope,
  taskId: string,
  viewerId: string,
): Promise<{ task: TaskRow; board: TaskBoardRow } | null> {
  try {
    return await loadTask(client, scope, taskId, viewerId);
  } catch (error) {
    // Only "not found" is an answer; anything else (the database) still fails.
    if (error instanceof TaskWriteError && error.reason === 'not_found') return null;
    throw error;
  }
}

/**
 * ⚠ WHO MAY OPEN IT, as a `where` — the query-side twin of `canOpenBoard`. The
 * two must say the same thing; `task.service.test.ts` holds them together.
 */
export function openableBy(viewerId: string): Array<{ ownerId: string } | { visibility: 'workspace' }> {
  return [{ ownerId: viewerId }, { visibility: 'workspace' }];
}
