import { zonedDayKey } from '@kwtech/module-kit';
import type { TaskRefusal } from '../types.js';

/**
 * A task's two dates, both optional (TASK-PLAN decision 11a, §0 E and F):
 *
 *   scheduled — the day somebody plans to work on it
 *   due       — the day it must be finished by
 *
 * ⚠ A DAY, NOT A MOMENT. Carried as `YYYY-MM-DD` and stored as a Postgres
 * `DATE`, never as a timestamp at UTC midnight: 5 Oct 00:00 UTC is 4 Oct in
 * New York, so a day stored as an instant moves a day for everyone west of UTC.
 * When times are added, a date WITH a time is an instant in UTC shown in the
 * viewer's zone; a date without one stays a day.
 */

export type TaskDay = string;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;

/**
 * A day as it arrives over the wire, validated: the shape AND a real calendar
 * day (`2026-02-30` is refused, not rolled into March). Null means "no date".
 */
export function prepareTaskDay(raw: string | null | undefined): { day: TaskDay | null } | { refused: TaskRefusal } {
  if (raw == null || raw === '') return { day: null };
  const match = DAY.exec(raw);
  if (!match) return { refused: 'invalid_date' };
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 2000 || year > 2999) return { refused: 'invalid_date' };
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { refused: 'invalid_date' };
  }
  return { day: raw };
}

/**
 * The day as Prisma writes it to a `DATE` column: midnight UTC of that day,
 * which Postgres truncates to the day itself. Only ever used at the database
 * boundary, and only with `taskDayFromDate` on the way back.
 */
export function taskDayToDate(day: TaskDay): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** A `DATE` column as Prisma reads it (midnight UTC) back to its day. */
export function taskDayFromDate(date: Date | null): TaskDay | null {
  return date === null ? null : date.toISOString().slice(0, 10);
}

/**
 * The WORKSPACE's calendar day — what "today" and "overdue" are measured
 * against. Never the server's, and no longer the viewer's own (PLAN §13,
 * 2026-09-29): everyone in a workspace sees the same today, so a task due today
 * is due today for the whole team, wherever each of them happens to be.
 */
export function workspaceTaskDay(now: Date, timeZone: string): TaskDay {
  return zonedDayKey(now, timeZone);
}

/**
 * Whether the task is overdue on `today`. Only an UNFINISHED task with a due
 * day before today: finished work is never late, and a task due today is not
 * yet overdue. Days compare as strings because `YYYY-MM-DD` sorts as dates.
 */
export function isTaskOverdue(task: { dueOn: TaskDay | null; completed: boolean }, today: TaskDay): boolean {
  return !task.completed && task.dueOn !== null && task.dueOn < today;
}

/**
 * Whether the task is planned for AFTER it is due — allowed, and shown as a
 * warning rather than refused (§0 F): plans slip, and refusing would block
 * saving either date.
 */
export function isScheduledAfterDue(task: { scheduledOn: TaskDay | null; dueOn: TaskDay | null }): boolean {
  return task.scheduledOn !== null && task.dueOn !== null && task.scheduledOn > task.dueOn;
}

/** The groups of My tasks, in the order they are shown. */
export type TaskDayGroup = 'overdue' | 'today' | 'this_week' | 'later' | 'no_date';

/**
 * Where a task sits in My tasks: OVERDUE by its due day always; otherwise by
 * its scheduled day, or its due day when it has none (§6).
 */
export function taskDayGroup(
  task: { scheduledOn: TaskDay | null; dueOn: TaskDay | null; completed: boolean },
  today: TaskDay,
): TaskDayGroup {
  if (isTaskOverdue(task, today)) return 'overdue';
  const day = task.scheduledOn ?? task.dueOn;
  if (day === null) return 'no_date';
  if (day <= today) return 'today';
  return day <= addDays(today, 6) ? 'this_week' : 'later';
}

/** `day` plus `count` calendar days. */
export function addDays(day: TaskDay, count: number): TaskDay {
  const date = taskDayToDate(day);
  date.setUTCDate(date.getUTCDate() + count);
  return taskDayFromDate(date) ?? day;
}

/**
 * How many days ahead count as "soon": due or planned within this many days
 * after today. Three, so Friday's work shows on Tuesday (the operator's
 * request, 2026-09-28: see nearing dates, not only late ones).
 */
export const TASK_SOON_DAYS = 3;

/** What needs the viewer's attention, counted — the Tasks header's chip. */
export interface TaskAttention {
  overdue: number;
  today: number;
  soon: number;
}

/**
 * Counts unfinished tasks by how urgent their dates are.
 *
 *   overdue — due before today (`isTaskOverdue`)
 *   today   — My tasks' Today group: planned (or due) today or earlier
 *   soon    — neither, but planned OR due within `TASK_SOON_DAYS`. Either day
 *             counts, so a task planned for after its due day still shows as
 *             its deadline nears.
 *
 * ⚠ Built on `taskDayGroup`, so the chip and My tasks never disagree about
 * what is overdue or today. Finished tasks count for nothing.
 */
export function taskAttention(
  tasks: readonly { scheduledOn: TaskDay | null; dueOn: TaskDay | null; completed: boolean }[],
  today: TaskDay,
): TaskAttention {
  const counts: TaskAttention = { overdue: 0, today: 0, soon: 0 };
  const horizon = addDays(today, TASK_SOON_DAYS);
  const near = (day: TaskDay | null) => day !== null && day > today && day <= horizon;
  for (const task of tasks) {
    if (task.completed) continue;
    const group = taskDayGroup(task, today);
    if (group === 'overdue' || group === 'today') counts[group] += 1;
    else if (near(task.scheduledOn) || near(task.dueOn)) counts.soon += 1;
  }
  return counts;
}

/** Whether an unfinished task's due day is today or within `TASK_SOON_DAYS` — a card's amber due date. */
export function isTaskDueSoon(task: { dueOn: TaskDay | null; completed: boolean }, today: TaskDay): boolean {
  return !task.completed && task.dueOn !== null && task.dueOn >= today && task.dueOn <= addDays(today, TASK_SOON_DAYS);
}
