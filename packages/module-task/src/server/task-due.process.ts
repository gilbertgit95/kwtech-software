import {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  type ProcessHandler,
  type ProcessRunContext,
  type ProcessRunResult,
  type ProcessWorkspace,
  processOccurrence,
} from '@kwtech/module-kit';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { taskDayToDate } from '../domain/dates.js';
import { dueReminderRecipients } from '../domain/reminders.js';
import type { TaskMemberDirectory, TaskNotifier } from './ports.js';
import type {
  InScope,
  TaskBoardRow,
  TaskDueReminderOutcome,
  TaskDueWhere,
  TaskRow,
  TaskWriteClient,
} from './task.repository.js';
import { TASK_MEMBER_DIRECTORY, TASK_NOTIFIER, TASK_PRISMA_WRITE } from './task.tokens.js';

/** Workspaces read per page: never all of them in memory (JOBS-PLAN §4c). */
const WORKSPACE_PAGE = 100;

/**
 * `task.due_today` — on the day a task is due, tells its people.
 *
 * Built to the rules every process answers for (JOBS-PLAN §4c):
 *
 *   SWEEPS      it asks "which unfinished tasks are due today, here, with no
 *               reminder yet", workspace by workspace. No timer per task.
 *   IDEMPOTENT  the reminder's row (`task_due_reminder`, keyed by task and day)
 *               is written BEFORE anybody is told, and a task with one stops
 *               matching the sweep. Run twice, the second finds nothing.
 *   BATCHES     a page of workspaces, at most `maxItems` tasks a run, one small
 *               write per task and no long transaction. The rest wait for the
 *               next run, which finds them because they are still unmarked.
 *   ANY TIME    "today" is each workspace's own day, worked out from the run's
 *               clock and the workspace's zone. Late, it skips what is past the
 *               window and counts it; it never assumes it ran on time.
 *
 * ⚠ AT MOST ONCE, deliberately. The row is written first, so a server dying
 * between the write and the notice loses that one reminder rather than risking
 * two. A reminder is a courtesy; the same one twice is a fault.
 */
@Injectable()
export class TaskDueTodayProcess implements ProcessHandler {
  private readonly logger = new Logger('TaskDueToday');

  constructor(
    @Inject(TASK_PRISMA_WRITE) private readonly prisma: TaskWriteClient,
    /** Unbound: nobody can be shown to be a member, so nobody is told — fail closed. */
    @Optional() @Inject(TASK_MEMBER_DIRECTORY) private readonly directory?: TaskMemberDirectory,
    /** Unbound: nobody is told, and nothing is marked, so binding it later the same day still reminds. */
    @Optional() @Inject(TASK_NOTIFIER) private readonly notifier?: TaskNotifier,
  ) {}

  async run(context: ProcessRunContext): Promise<ProcessRunResult> {
    const counts: ProcessRunResult = { handled: 0, skippedLate: 0, leftForNext: 0 };
    if (!this.notifier) return counts;

    let cursor: string | null = null;
    // Sequential on purpose: the item limit is one budget across every workspace.
    do {
      const page = await context.workspaces(cursor, WORKSPACE_PAGE);
      for (const workspace of page.workspaces) {
        if (context.signal.aborted) return counts;
        const budget = context.maxItems - counts.handled - counts.skippedLate;
        const full = await this.sweep(workspace, context, budget, counts);
        // The limit was reached here: later workspaces are the next run's, found because they are unmarked.
        if (full) return counts;
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    return counts;
  }

  /**
   * One workspace. Returns true when the run's item limit was reached in it,
   * having counted what this workspace still has waiting.
   */
  private async sweep(
    workspace: ProcessWorkspace,
    context: ProcessRunContext,
    budget: number,
    counts: ProcessRunResult,
  ): Promise<boolean> {
    // ⚠ Never UTC for a zone that cannot be read: that would move every evening to the next day.
    const timeZone = isValidTimeZone(workspace.timeZone) ? workspace.timeZone : DEFAULT_TIME_ZONE;
    const occurrence = processOccurrence(context.schedule, context.now, timeZone, context.tooLateAfterMinutes);
    if (occurrence.kind === 'none') return false;

    const scope: InScope = { organizationId: workspace.organizationId, workspaceId: workspace.workspaceId };
    const dueOn = taskDayToDate(occurrence.dayKey);
    const where: TaskDueWhere = {
      ...scope,
      dueOn,
      completedAt: null,
      archivedAt: null,
      board: { archivedAt: null },
      dueReminders: { none: { dueOn } },
    };
    const tasks = await this.prisma.task.findMany({ where, orderBy: [{ id: 'asc' }], take: budget });
    if (tasks.length === 0) return false;

    if (occurrence.kind === 'too_late') await this.skipLate(tasks, dueOn, context, counts);
    else await this.remind(scope, tasks, dueOn, occurrence.dayKey, context, counts);

    if (tasks.length < budget) return false;
    // Whatever still matches was neither reminded nor skipped: it waits.
    counts.leftForNext += await this.prisma.task.count({ where });
    return true;
  }

  private async skipLate(
    tasks: readonly TaskRow[],
    dueOn: Date,
    context: ProcessRunContext,
    counts: ProcessRunResult,
  ): Promise<void> {
    for (const task of tasks) {
      if (context.signal.aborted) return;
      if (await this.record(task, dueOn, 'skipped_late')) counts.skippedLate += 1;
    }
  }

  private async remind(
    scope: InScope,
    tasks: readonly TaskRow[],
    dueOn: Date,
    dayKey: string,
    context: ProcessRunContext,
    counts: ProcessRunResult,
  ): Promise<void> {
    const [assignees, boards] = await Promise.all([
      this.prisma.taskAssignee.findMany({ where: { taskId: { in: tasks.map((task) => task.id) } } }),
      this.prisma.taskBoard.findMany({
        where: { ...scope, id: { in: [...new Set(tasks.map((task) => task.boardId))] } },
        orderBy: [{ id: 'asc' }],
        take: tasks.length,
      }),
    ]);
    const boardById = new Map<string, TaskBoardRow>(boards.map((board) => [board.id, board]));
    const assignedTo = new Map<string, string[]>();
    for (const assignee of assignees) {
      assignedTo.set(assignee.taskId, [...(assignedTo.get(assignee.taskId) ?? []), assignee.userId]);
    }

    // One question for the whole batch: who, of everybody who might be told, still works here.
    const everybody = [...new Set(tasks.flatMap((task) => [task.creatorId, ...(assignedTo.get(task.id) ?? [])]))];
    const active = this.directory
      ? await this.directory.activeMembers(scope.organizationId, scope.workspaceId, everybody)
      : new Set<string>();

    // In order, one at a time: each is a claim then a notice, and the limit is counted as it goes.
    for (const task of tasks) {
      if (context.signal.aborted) return;
      const board = boardById.get(task.boardId);
      const recipientIds = board
        ? dueReminderRecipients(board, task.creatorId, assignedTo.get(task.id) ?? [], active)
        : [];

      // ⚠ The row first. Somebody else's row means somebody else's reminder: tell nobody.
      const claimed = await this.record(task, dueOn, recipientIds.length > 0 ? 'sent' : 'no_recipient');
      if (!claimed) continue;
      counts.handled += 1;
      if (!board || recipientIds.length === 0) continue;

      await this.notifier
        ?.dueToday({
          recipientIds,
          organizationId: scope.organizationId,
          workspaceId: scope.workspaceId,
          boardId: board.id,
          boardName: board.name,
          taskId: task.id,
          taskTitle: task.title,
          dueOn: dayKey,
        })
        // A notice that cannot be sent never fails the run. Counts and errors, never names.
        .catch((error: unknown) => this.logger.warn(`Could not send a due reminder: ${(error as Error).message}`));
    }
  }

  /**
   * Writes that this task's reminder for this day is dealt with. False when it
   * already was — another run, or another server, got there first.
   */
  private async record(task: TaskRow, dueOn: Date, outcome: TaskDueReminderOutcome): Promise<boolean> {
    try {
      await this.prisma.taskDueReminder.create({
        data: {
          organizationId: task.organizationId,
          workspaceId: task.workspaceId,
          taskId: task.id,
          dueOn,
          outcome,
        },
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }
}

/** Prisma's `P2002`, detected structurally: this package does not import `@prisma/client`. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
