import type { TaskBoardFacts, TaskBoardVisibility, TaskFacts, TaskRefusal } from '../types.js';

/**
 * Who may do what on a board (TASK-PLAN decisions 2a, 8, 10, 14 and §3).
 *
 * These decide over ONE BOARD (and task) AND ONE PERSON. Whether the person
 * holds `task:read` or `task:write` in the workspace is the guard's question,
 * asked before any of this runs; these answer what that key allows HERE.
 *
 * ⚠ ORDER MATTERS IN EVERY CHECK: can they open the board, first. A refusal
 * that is anything but `not_found` tells the caller the board exists, so no
 * other reason may be given for a board they cannot open.
 */

export const TASK_BOARD_VISIBILITIES = ['private', 'workspace'] as const satisfies readonly TaskBoardVisibility[];

/** A visibility as it arrives over the wire — a string — narrowed. */
export function isTaskBoardVisibility(value: unknown): value is TaskBoardVisibility {
  return (TASK_BOARD_VISIBILITIES as readonly unknown[]).includes(value);
}

/**
 * Whether this person may open the board at all — THE access rule. Every
 * service, every query's `where` and the event filter use this one function;
 * a second copy of it would be an incident.
 *
 * ⚠ NO OVERRIDE. Not `task:manage_all`, not a super admin: a private board is
 * its owner's alone (TASK-PLAN §0 C), so this takes no key and no role.
 *
 * An archived board is still OPENED by whoever could open it live, read-only,
 * so the archive can be browsed and restored.
 */
export function canOpenBoard(board: Pick<TaskBoardFacts, 'ownerId' | 'visibility'>, userId: string): boolean {
  if (board.ownerId === userId) return true;
  return board.visibility === 'workspace';
}

/**
 * Configuring the board — its name, columns, kind: the OWNER's alone.
 *
 * ⚠ An archived board is read-only; restore it first. Renaming or reshaping a
 * board nobody is looking at is how a restore surprises its owner.
 */
export function checkConfigureBoard(board: TaskBoardFacts, userId: string): TaskRefusal | null {
  if (!canOpenBoard(board, userId)) return 'not_found';
  if (board.ownerId !== userId) return 'not_owner';
  if (board.archivedAt !== null) return 'board_archived';
  return null;
}

/** Archiving, restoring or deleting a board forever: the owner's alone, in the right state. */
export function checkBoardLifecycle(
  board: TaskBoardFacts,
  userId: string,
  act: 'archive' | 'restore' | 'delete_forever',
): TaskRefusal | null {
  if (!canOpenBoard(board, userId)) return 'not_found';
  if (board.ownerId !== userId) return 'not_owner';
  if (act === 'archive') return board.archivedAt === null ? null : 'board_archived';
  // ⚠ DELETE FOREVER ONLY FROM THE ARCHIVE (decision 14): one act that cannot be
  // undone is never one click from a live board with a team's tasks on it.
  return board.archivedAt === null ? 'board_not_archived' : null;
}

/**
 * Working with a task — editing, moving, dates, checklist, labels, commenting —
 * on a board this person can open.
 *
 * Anybody who can open a shared board may work with its tasks (decision 9); the
 * guard has already asked for `task:write`. An archived task, or any task on an
 * archived board, is read-only: restore it first.
 */
export function checkWorkWithTask(board: TaskBoardFacts, task: TaskFacts, userId: string): TaskRefusal | null {
  if (!canOpenBoard(board, userId)) return 'not_found';
  if (board.archivedAt !== null) return 'board_archived';
  if (task.archivedAt !== null) return 'archived';
  return null;
}

/** Creating a task needs a live board you can open — the same as working with one. */
export function checkCreateTask(board: TaskBoardFacts, userId: string): TaskRefusal | null {
  if (!canOpenBoard(board, userId)) return 'not_found';
  if (board.archivedAt !== null) return 'board_archived';
  return null;
}

/** The three acts that put a task away or bring it back. */
export type TaskArchiveAct = 'archive' | 'restore' | 'delete_forever';

/**
 * Whether this person may archive, restore or delete a task forever — or
 * whether it depends on `task:manage_all`, which only the host can answer.
 *
 * A PLAN, not a boolean, because the answer may need a port: the service asks
 * `TaskAccessCheck` only on `needs_manage_all`.
 *
 *   archive, restore — anyone who works with the board's tasks: archiving is
 *                      tidying the board, and it is undone in one click.
 *   delete forever   — the task's creator, the board's owner, or
 *                      `task:manage_all`; and ONLY FROM THE ARCHIVE.
 */
export type TaskArchivePlan =
  | { kind: 'allowed' }
  | { kind: 'needs_manage_all' }
  | { kind: 'refused'; reason: TaskRefusal };

export function planTaskArchiveAct(
  board: TaskBoardFacts,
  task: TaskFacts,
  userId: string,
  act: TaskArchiveAct,
): TaskArchivePlan {
  if (!canOpenBoard(board, userId)) return { kind: 'refused', reason: 'not_found' };
  if (board.archivedAt !== null) return { kind: 'refused', reason: 'board_archived' };

  if (act === 'archive' && task.archivedAt !== null) return { kind: 'refused', reason: 'archived' };
  if (act !== 'archive' && task.archivedAt === null) return { kind: 'refused', reason: 'not_archived' };
  if (act !== 'delete_forever') return { kind: 'allowed' };

  if (task.creatorId === userId || board.ownerId === userId) return { kind: 'allowed' };
  return { kind: 'needs_manage_all' };
}

/**
 * Editing a comment: its AUTHOR's alone. Nobody may put words in somebody
 * else's mouth, `manage_all` included.
 */
export function checkEditComment(
  board: TaskBoardFacts,
  comment: { authorId: string },
  userId: string,
): TaskRefusal | null {
  if (!canOpenBoard(board, userId)) return 'not_found';
  if (board.archivedAt !== null) return 'board_archived';
  if (comment.authorId !== userId) return 'not_permitted';
  return null;
}

/** Removing a comment: its author, the board's owner, or `task:manage_all`. */
export function planRemoveComment(
  board: TaskBoardFacts,
  comment: { authorId: string },
  userId: string,
): TaskArchivePlan {
  if (!canOpenBoard(board, userId)) return { kind: 'refused', reason: 'not_found' };
  if (board.archivedAt !== null) return { kind: 'refused', reason: 'board_archived' };
  if (comment.authorId === userId || board.ownerId === userId) return { kind: 'allowed' };
  return { kind: 'needs_manage_all' };
}

/** At most this many people on one task (decision 11). */
export const TASK_ASSIGNEES_MAX = 10;

/**
 * Whether a new list of assignees may be set, and whether it needs
 * `task:assign` — which only the host can answer.
 *
 *   - On a PRIVATE board, only its owner may be assigned: an assignee who
 *     cannot open the board is a promise the board breaks (TASK-PLAN §0 A).
 *   - Assigning YOURSELF needs only `task:write`. Adding anybody ELSE needs
 *     `task:assign`. REMOVING people needs nothing more than write: tidying a
 *     task's assignees is not pointing work at anyone.
 *
 * ⚠ Whether each id is an active member who may be assigned at all is the
 * directory port's question, asked by the service for every NEWLY ADDED id —
 * this decides only what the board and the actor allow.
 */
export type TaskAssignPlan =
  | { kind: 'allowed'; added: readonly string[]; removed: readonly string[] }
  | { kind: 'needs_assign'; added: readonly string[]; removed: readonly string[] }
  | { kind: 'refused'; reason: TaskRefusal };

export function planSetAssignees(
  board: Pick<TaskBoardFacts, 'ownerId' | 'visibility'>,
  current: readonly string[],
  next: readonly string[],
  actorId: string,
): TaskAssignPlan {
  const wanted = [...new Set(next)];
  if (wanted.length > TASK_ASSIGNEES_MAX) return { kind: 'refused', reason: 'too_many_assignees' };
  if (wanted.some((userId) => userId.length === 0)) return { kind: 'refused', reason: 'not_assignable' };
  if (board.visibility === 'private' && wanted.some((userId) => userId !== board.ownerId)) {
    return { kind: 'refused', reason: 'not_assignable' };
  }

  const before = new Set(current);
  const added = wanted.filter((userId) => !before.has(userId));
  const removed = current.filter((userId) => !wanted.includes(userId));
  if (added.every((userId) => userId === actorId)) return { kind: 'allowed', added, removed };
  return { kind: 'needs_assign', added, removed };
}
