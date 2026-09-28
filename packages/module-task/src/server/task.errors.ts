import { TASK_ASSIGNEES_MAX } from '../domain/access.js';
import { TASK_BOARD_NAME_MAX, TASK_COLUMN_NAME_MAX, TASK_COLUMNS_MAX } from '../domain/boards.js';
import { TASK_LABEL_MAX, TASK_LABELS_MAX } from '../domain/labels.js';
import {
  TASK_CHECKLIST_ITEM_MAX,
  TASK_CHECKLIST_MAX,
  TASK_COMMENT_MAX,
  TASK_COMMENTS_MAX,
  TASK_CONFLICT_MESSAGE,
  TASK_NOT_FOUND_MESSAGE,
  TASK_TITLE_MAX,
} from '../domain/tasks.js';
import type { TaskRefusal } from '../types.js';

/**
 * One error type for every refusal a task operation makes.
 *
 * A REASON CODE, not a message: the transport decides the wording's fate, and a
 * caller that has to regex a sentence gets it wrong on the first rewording.
 *
 * ⚠ The app sees only the MESSAGE (`formatError` strips `extensions` in
 * production), so the refusals it must act on — not found, conflict — carry the
 * exact messages exported from the domain, and it compares those.
 */
export class TaskWriteError extends Error {
  constructor(
    readonly reason: TaskRefusal,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'TaskWriteError';
  }
}

/**
 * ⚠ ONE MESSAGE for a board or task that does not exist, is in another
 * workspace, or is on somebody else's private board. Any difference — even in
 * wording — tells a prober which of the three it hit.
 */
export function taskNotFound(): TaskWriteError {
  return new TaskWriteError('not_found', TASK_NOT_FOUND_MESSAGE);
}

/** The sentence for each refusal a domain check can return. */
export function refusalError(reason: TaskRefusal): TaskWriteError {
  return new TaskWriteError(reason, REFUSAL_MESSAGES[reason]);
}

const REFUSAL_MESSAGES: Record<TaskRefusal, string> = {
  not_found: TASK_NOT_FOUND_MESSAGE,
  not_permitted: 'You cannot do that to somebody else’s work here',
  not_owner: 'Only the board’s owner can change that',
  board_archived: 'That board is archived — restore it first',
  board_not_archived: 'Only an archived board can be restored or deleted forever',
  archived: 'That task is archived — restore it first',
  not_archived: 'Only an archived task can be restored or deleted forever',
  conflict: TASK_CONFLICT_MESSAGE,
  limit_reached: 'You have reached the most you can keep here',
  not_assignable: 'Somebody on that list cannot be assigned to this task',
  too_many_assignees: `A task can have at most ${TASK_ASSIGNEES_MAX} people assigned`,
  invalid_name: `A board needs a name of at most ${TASK_BOARD_NAME_MAX} characters, with no invisible formatting`,
  invalid_title: `A task needs a title of at most ${TASK_TITLE_MAX} characters, with no invisible formatting`,
  invalid_description: 'That description is too long to save',
  invalid_labels: `A task can have at most ${TASK_LABELS_MAX} labels of at most ${TASK_LABEL_MAX} characters each`,
  invalid_priority: 'A priority is low, normal, high or urgent',
  invalid_date: 'A date must be a real calendar day',
  invalid_visibility: 'A board is either private or shared with the workspace',
  invalid_column: `A column needs a name of at most ${TASK_COLUMN_NAME_MAX} characters, on the same board`,
  duplicate_column: 'This board already has a column with that name',
  too_many_columns: `A board can have at most ${TASK_COLUMNS_MAX} columns`,
  last_column: 'A board needs at least one column',
  last_done_column: 'This is the board’s only done column — mark another as done first',
  invalid_destination: 'Choose another column on this board for its tasks',
  invalid_checklist_item: `A checklist item needs some text, at most ${TASK_CHECKLIST_ITEM_MAX} characters`,
  too_many_checklist_items: `A checklist can have at most ${TASK_CHECKLIST_MAX} items`,
  invalid_comment: `A comment needs some text, at most ${TASK_COMMENT_MAX} characters`,
  too_many_comments: `A task can have at most ${TASK_COMMENTS_MAX} comments`,
  invalid_settings: 'Those view settings are not ones on offer',
};
