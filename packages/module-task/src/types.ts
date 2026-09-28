/**
 * The shapes the domain decides over. Plain data, no framework, so the server
 * half and the web half hold the same rules.
 */

/**
 * Who may open a board (TASK-PLAN decision 2a). There are exactly two kinds:
 *
 *   private   — its owner, and nobody else, whatever keys they hold.
 *   workspace — every member of the workspace holding `task:read`.
 *
 * ⚠ A BOARD'S KIND IS THE ONLY VISIBILITY. A task has none of its own: a private
 * task is a task on a private board (TASK-PLAN §0 A).
 */
export type TaskBoardVisibility = 'private' | 'workspace';

/** How urgent a task is. `normal` unless somebody says otherwise. */
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

/** The facts every board access decision needs, and no more. */
export interface TaskBoardFacts {
  ownerId: string;
  visibility: TaskBoardVisibility;
  /** When it was archived. Null while it is live. */
  archivedAt: Date | null;
}

/** The facts a task decision needs on top of its board's. */
export interface TaskFacts {
  creatorId: string;
  archivedAt: Date | null;
}

/** One column as the domain sees it: where it sits and whether it means finished. */
export interface TaskColumnFacts {
  id: string;
  done: boolean;
}

/**
 * Why a task operation was refused. One union for the module, carried by its
 * one error class at the service boundary.
 *
 * ⚠ `not_found` ALSO MEANS "somebody else's private board", "a task on one" and
 * "something in another workspace". Answering those differently would let
 * anyone probe ids and learn that a private board exists (TASK-PLAN §5).
 */
export type TaskRefusal =
  | 'not_found'
  | 'not_permitted'
  | 'not_owner'
  | 'board_archived'
  | 'board_not_archived'
  | 'archived'
  | 'not_archived'
  | 'conflict'
  | 'limit_reached'
  | 'not_assignable'
  | 'too_many_assignees'
  | 'invalid_name'
  | 'invalid_title'
  | 'invalid_description'
  | 'invalid_labels'
  | 'invalid_priority'
  | 'invalid_date'
  | 'invalid_visibility'
  | 'invalid_column'
  | 'duplicate_column'
  | 'too_many_columns'
  | 'last_column'
  | 'last_done_column'
  | 'invalid_destination'
  | 'invalid_checklist_item'
  | 'too_many_checklist_items'
  | 'invalid_comment'
  | 'too_many_comments'
  | 'invalid_settings';
