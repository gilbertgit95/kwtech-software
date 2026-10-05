import type { TaskBoardFacts } from '../types.js';
import { canOpenBoard } from './access.js';

/**
 * Who is told that a task is due today.
 *
 * The people ASSIGNED to it; when nobody is, whoever created it — an
 * unassigned task is still somebody's, and a deadline nobody hears about is the
 * gap this exists to close (PLAN §12.83).
 *
 * ⚠ ONLY PEOPLE WHO COULD OPEN THE TASK TODAY. A reminder carries the task's
 * title, so it goes to nobody who has left the workspace (`activeMembers`) and
 * to nobody a private board now shuts out (`canOpenBoard`) — a creator on a
 * board that has since gone private is not told about work they can no longer
 * see. Nobody left means nobody is told, which the caller records.
 */
export function dueReminderRecipients(
  board: Pick<TaskBoardFacts, 'ownerId' | 'visibility'>,
  creatorId: string,
  assigneeIds: readonly string[],
  activeMembers: ReadonlySet<string>,
): string[] {
  const candidates = assigneeIds.length > 0 ? assigneeIds : [creatorId];
  return [...new Set(candidates)].filter((userId) => activeMembers.has(userId) && canOpenBoard(board, userId));
}
