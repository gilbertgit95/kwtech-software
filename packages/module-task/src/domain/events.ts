import type { TaskBoardVisibility } from '../types.js';
import { canOpenBoard } from './access.js';

/**
 * Who hears about a change on a board, and as what (TASK-PLAN §5).
 *
 * ⚠ PER SUBSCRIBER, not per workspace. A private board's events would tell the
 * workspace it exists and when its owner works on it, so each subscriber runs
 * this over each event — with the SAME `canOpenBoard` every query uses.
 */

/**
 * What happened.
 *
 *   board     — the board itself: renamed, columns changed, archived, restored
 *   task      — a task on it: created, edited, moved, assigned, archived…
 *   comment   — a comment on one of its tasks
 *   hidden    — the board became private: everyone but its owner loses it
 *   deleted   — the board is gone
 *
 * `hidden` is its own change because it is the one event that must reach
 * people who can NO LONGER open the board (see `taskEventFor`).
 */
export type TaskChange = 'board' | 'task' | 'comment' | 'hidden' | 'deleted';

/** The facts a delivery decision reads. The visibility is the one AFTER the change. */
export interface TaskEventFacts {
  organizationId: string;
  workspaceId: string;
  boardId: string;
  ownerId: string;
  visibility: TaskBoardVisibility;
  change: TaskChange;
  /** The task it concerns, for `task` and `comment`. */
  taskId?: string | null;
}

/** Who is listening, on which workspace. */
export interface TaskEventViewer {
  userId: string;
  organizationId: string;
  workspaceId: string;
}

/**
 * What the viewer is told:
 *
 *   changed — read the board (or task) again
 *   removed — drop the board: deleted, or no longer shared with you
 *   null    — nothing; this board is not theirs to know about
 *
 * ⚠ `hidden` IS THE ONE EVENT FOR A BOARD THE VIEWER CAN NO LONGER OPEN. It says
 * nothing new — they could open it a moment ago — and without it the board
 * would sit on their screen until their next read.
 */
export function taskEventFor(event: TaskEventFacts, viewer: TaskEventViewer): 'changed' | 'removed' | null {
  if (event.organizationId !== viewer.organizationId || event.workspaceId !== viewer.workspaceId) return null;

  const isOwner = event.ownerId === viewer.userId;
  if (event.change === 'hidden') return isOwner ? 'changed' : 'removed';
  if (!canOpenBoard(event, viewer.userId)) return null;
  if (event.change === 'deleted') return 'removed';
  return 'changed';
}
