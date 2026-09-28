import type { LimitChecker, LimitDecision } from '@kwtech/module-kit';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  checkCreateTask,
  checkWorkWithTask,
  planSetAssignees,
  planTaskArchiveAct,
  type TaskArchiveAct,
} from '../domain/access.js';
import { prepareTaskDay, type TaskDay, taskDayFromDate, taskDayToDate } from '../domain/dates.js';
import { prepareTaskLabels } from '../domain/labels.js';
import { rankAfter, rankBetween, rebalancedRanks } from '../domain/rank.js';
import {
  checkTaskVersion,
  completedAtAfterMove,
  isTaskPriority,
  prepareChecklistText,
  prepareTaskDescription,
  prepareTaskTitle,
  TASK_CHECKLIST_MAX,
} from '../domain/tasks.js';
import { TASK_LIMIT, TASK_LIMIT_REGISTRY } from '../feature-keys.js';
import type { TaskRefusal } from '../types.js';
import type { TaskAccessCheck, TaskMemberDirectory, TaskNotifier } from './ports.js';
import { refusalError, TaskWriteError } from './task.errors.js';
import { TaskEventPublisher } from './task.events.js';
import { loadBoard, loadTask, type TaskScope } from './task.lookup.js';
import type {
  TaskBoardRow,
  TaskColumnRow,
  TaskRow,
  TaskTransaction,
  TaskUpdate,
  TaskWriteClient,
} from './task.repository.js';
import { normalizeTaskSettings, TASK_BOARD_READ_MAX, TASK_VIEWS, type TaskSettings } from './task.service.js';
import {
  TASK_ACCESS_CHECK,
  TASK_LIMIT_CHECKER,
  TASK_MEMBER_DIRECTORY,
  TASK_NOTIFIER,
  TASK_PRISMA_WRITE,
} from './task.tokens.js';

export interface CreateTaskInput {
  title: string;
  description?: string | null | undefined;
  /** Omitted: the board's first column. */
  columnId?: string | null | undefined;
  priority?: string | null | undefined;
  scheduledOn?: string | null | undefined;
  dueOn?: string | null | undefined;
  labels?: readonly string[] | null | undefined;
  assigneeIds?: readonly string[] | null | undefined;
}

export interface MoveTaskInput {
  /** Another board to move it to; omitted, it stays on its own. */
  boardId?: string | null | undefined;
  columnId: string;
  /** The task it lands just after, in that column; null: the top. */
  afterTaskId?: string | null | undefined;
}

/**
 * Every write to a task and its checklist.
 *
 * Each one: find the task BY ID AND SCOPE through its board (`loadTask`), ask
 * the domain whether this person may, write, then publish — and notify — after
 * the commit.
 */
@Injectable()
export class TaskWriteService {
  private readonly logger = new Logger('TaskWrites');

  constructor(
    @Inject(TASK_PRISMA_WRITE) private readonly prisma: TaskWriteClient,
    private readonly events: TaskEventPublisher,
    /** Unbound: the declared default cap. */
    @Optional() @Inject(TASK_LIMIT_CHECKER) private readonly limits?: LimitChecker,
    /** Unbound: nobody holds `task:assign` or `task:manage_all`. */
    @Optional() @Inject(TASK_ACCESS_CHECK) private readonly access?: TaskAccessCheck,
    /** Unbound: you can assign only yourself. */
    @Optional() @Inject(TASK_MEMBER_DIRECTORY) private readonly directory?: TaskMemberDirectory,
    /** Unbound: nobody is told. */
    @Optional() @Inject(TASK_NOTIFIER) private readonly notifier?: TaskNotifier,
  ) {}

  // ── creating ──────────────────────────────────────────────────────────────

  /**
   * A new task at the BOTTOM of its column — the top of a column is somebody's
   * priority, and a new card should not push it down.
   *
   * ⚠ THE CAP IS COUNTED IN THE TRANSACTION THAT INSERTS, per person and
   * archived tasks included.
   */
  async create(scope: TaskScope, actorId: string, boardId: string, input: CreateTaskInput): Promise<TaskRow> {
    const { title } = unwrap(prepareTaskTitle(input.title));
    const { description } = unwrap(prepareTaskDescription(input.description ?? ''));
    const priority = input.priority ?? 'normal';
    if (!isTaskPriority(priority)) throw refusalError('invalid_priority');
    const { day: scheduledOn } = unwrap(prepareTaskDay(input.scheduledOn));
    const { day: dueOn } = unwrap(prepareTaskDay(input.dueOn));
    const { labels } = unwrap(prepareTaskLabels(input.labels ?? []));

    const board = await loadBoard(this.prisma, scope, boardId, actorId);
    refuse(checkCreateTask(board, actorId));
    const assignees = await this.approveAssignees(scope, board, [], input.assigneeIds ?? [], actorId);

    const task = await this.prisma.$transaction(async (tx) => {
      const current = await tx.task.count({ where: { ...scope, creatorId: actorId } });
      const decision = await this.checkCap(scope, actorId, current);
      if (!decision.allowed) {
        throw new TaskWriteError('limit_reached', `You can keep ${decision.limit} tasks here, counting archived ones`, {
          limit: decision.limit,
        });
      }
      const columns = await columnsOf(tx, board.id);
      const column = input.columnId ? columns.find((candidate) => candidate.id === input.columnId) : columns[0];
      if (!column) throw refusalError('invalid_column');
      const [last] = await tx.task.findMany({
        where: { ...scope, boardId: board.id, columnId: column.id },
        orderBy: [{ rank: 'desc' }, { id: 'desc' }],
        take: 1,
      });
      const created = await tx.task.create({
        data: {
          ...scope,
          boardId: board.id,
          columnId: column.id,
          rank: rankBetween(last?.rank ?? null, null) ?? 0,
          creatorId: actorId,
          title,
          description,
          priority,
          scheduledOn: scheduledOn === null ? null : taskDayToDate(scheduledOn),
          dueOn: dueOn === null ? null : taskDayToDate(dueOn),
          labels: [...labels],
          completedAt: column.done ? new Date() : null,
          updatedById: actorId,
        },
      });
      for (const userId of assignees.added) {
        await tx.taskAssignee.create({
          data: { ...scope, taskId: created.id, boardId: board.id, userId, assignedById: actorId },
        });
      }
      return created;
    });

    await this.events.changed(board, 'task', actorId, task.id);
    await this.notifyAssigned(board, task, assignees.added, actorId);
    return task;
  }

  // ── saving the text ───────────────────────────────────────────────────────

  /**
   * The title and description, from `expectedVersion` (decision 17). A stale
   * save is refused with `TASK_CONFLICT_MESSAGE`; an unchanged one writes
   * nothing, so an autosave never conflicts with a real edit for no reason.
   */
  async update(
    scope: TaskScope,
    actorId: string,
    taskId: string,
    expectedVersion: number,
    input: { title?: string | null | undefined; description?: string | null | undefined },
  ): Promise<TaskRow> {
    const { task, board } = await loadTask(this.prisma, scope, taskId, actorId);
    refuse(checkWorkWithTask(board, task, actorId));
    // ⚠ After access, always: a conflict must never confirm a task exists.
    refuse(checkTaskVersion(expectedVersion, task.version));

    const data: TaskUpdate = {};
    if (input.title != null) {
      const { title } = unwrap(prepareTaskTitle(input.title));
      if (title !== task.title) data.title = title;
    }
    if (input.description != null) {
      const { description } = unwrap(prepareTaskDescription(input.description));
      if (description !== task.description) data.description = description;
    }
    if (Object.keys(data).length === 0) return task;

    const moved = await this.prisma.task.updateMany({
      where: { ...scope, id: task.id, version: task.version },
      data: { ...data, updatedById: actorId, version: { increment: 1 } },
    });
    // Somebody saved between our read and our write. Their save stands.
    if (moved.count === 0) throw refusalError('conflict');
    return this.saved(scope, task.id, actorId);
  }

  // ── moving ────────────────────────────────────────────────────────────────

  /**
   * To a column — on this board or another the actor can open — just after
   * `afterTaskId` (null: the top). The board's order is shared (decision 13).
   *
   * Onto a PRIVATE board, only its owner stays assigned (decision 13).
   */
  async move(scope: TaskScope, actorId: string, taskId: string, input: MoveTaskInput): Promise<TaskRow> {
    const { task, board } = await loadTask(this.prisma, scope, taskId, actorId);
    refuse(checkWorkWithTask(board, task, actorId));
    const target =
      input.boardId && input.boardId !== board.id ? await loadBoard(this.prisma, scope, input.boardId, actorId) : board;
    refuse(checkCreateTask(target, actorId));

    await this.prisma.$transaction(async (tx) => {
      const columns = await columnsOf(tx, target.id);
      const column = columns.find((candidate) => candidate.id === input.columnId);
      if (!column) throw refusalError('invalid_column');

      let rank = await placeInColumn(tx, scope, target.id, column.id, task.id, input.afterTaskId ?? null);
      if (rank === null) {
        await rebalanceColumn(tx, scope, target.id, column.id);
        rank = await placeInColumn(tx, scope, target.id, column.id, task.id, input.afterTaskId ?? null);
      }
      await tx.task.updateMany({
        where: { ...scope, id: task.id },
        data: {
          boardId: target.id,
          columnId: column.id,
          rank: rank ?? 0,
          completedAt: completedAtAfterMove(task.completedAt, column.done, new Date()),
          updatedById: actorId,
        },
      });
      if (target.id !== board.id) {
        await tx.taskAssignee.updateMany({ where: { taskId: task.id }, data: { boardId: target.id } });
        if (target.visibility === 'private') {
          await tx.taskAssignee.deleteMany({ where: { taskId: task.id, userId: { not: target.ownerId } } });
        }
      }
    });

    if (target.id !== board.id) await this.events.changed(board, 'task', actorId, task.id);
    return this.saved(scope, task.id, actorId);
  }

  // ── the small fields ──────────────────────────────────────────────────────

  /** Both dates at once, either or both null (decision 11a). Scheduled after due is allowed (§0 F). */
  async setDates(
    scope: TaskScope,
    actorId: string,
    taskId: string,
    scheduledOn: string | null | undefined,
    dueOn: string | null | undefined,
  ): Promise<TaskRow> {
    const scheduled = unwrap(prepareTaskDay(scheduledOn)).day;
    const due = unwrap(prepareTaskDay(dueOn)).day;
    return this.patch(scope, actorId, taskId, (task) =>
      sameDay(task.scheduledOn, scheduled) && sameDay(task.dueOn, due)
        ? null
        : {
            scheduledOn: scheduled === null ? null : taskDayToDate(scheduled),
            dueOn: due === null ? null : taskDayToDate(due),
          },
    );
  }

  async setPriority(scope: TaskScope, actorId: string, taskId: string, priority: string): Promise<TaskRow> {
    if (!isTaskPriority(priority)) throw refusalError('invalid_priority');
    return this.patch(scope, actorId, taskId, (task) => (task.priority === priority ? null : { priority }));
  }

  async setLabels(scope: TaskScope, actorId: string, taskId: string, raw: readonly string[]): Promise<TaskRow> {
    const { labels } = unwrap(prepareTaskLabels(raw));
    return this.patch(scope, actorId, taskId, (task) =>
      task.labels.join('\n') === labels.join('\n') ? null : { labels: [...labels] },
    );
  }

  /**
   * The whole list of assignees, as the picker has it (decision 11). Newly
   * added people are told, never the person who added them.
   */
  async setAssignees(scope: TaskScope, actorId: string, taskId: string, userIds: readonly string[]): Promise<TaskRow> {
    const { task, board } = await loadTask(this.prisma, scope, taskId, actorId);
    refuse(checkWorkWithTask(board, task, actorId));
    const current = (await this.prisma.taskAssignee.findMany({ where: { taskId: task.id } })).map((row) => row.userId);
    const change = await this.approveAssignees(scope, board, current, userIds, actorId);
    if (change.added.length === 0 && change.removed.length === 0) return task;

    await this.prisma.$transaction(async (tx) => {
      if (change.removed.length > 0) {
        await tx.taskAssignee.deleteMany({ where: { taskId: task.id, userId: { in: [...change.removed] } } });
      }
      for (const userId of change.added) {
        await tx.taskAssignee.create({
          data: { ...scope, taskId: task.id, boardId: board.id, userId, assignedById: actorId },
        });
      }
    });

    const saved = await this.saved(scope, task.id, actorId);
    await this.notifyAssigned(board, saved, change.added, actorId);
    return saved;
  }

  // ── the checklist ─────────────────────────────────────────────────────────

  async addChecklistItem(scope: TaskScope, actorId: string, taskId: string, rawText: string): Promise<TaskRow> {
    const { text } = unwrap(prepareChecklistText(rawText));
    return this.checklist(scope, actorId, taskId, async (task, tx) => {
      if ((await tx.taskChecklistItem.count({ where: { taskId: task.id } })) >= TASK_CHECKLIST_MAX) {
        throw refusalError('too_many_checklist_items');
      }
      const items = await tx.taskChecklistItem.findMany({
        where: { taskId: task.id },
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      });
      const rank = rankBetween(items[items.length - 1]?.rank ?? null, null) ?? 0;
      await tx.taskChecklistItem.create({ data: { ...scope, taskId: task.id, text, rank } });
    });
  }

  async updateChecklistItem(
    scope: TaskScope,
    actorId: string,
    taskId: string,
    itemId: string,
    input: { text?: string | null | undefined; done?: boolean | null | undefined },
  ): Promise<TaskRow> {
    const text = input.text == null ? undefined : unwrap(prepareChecklistText(input.text)).text;
    return this.checklist(scope, actorId, taskId, async (task, tx) => {
      // ⚠ Through its task: an item id from another task is not found.
      const item = await tx.taskChecklistItem.findFirst({ where: { id: itemId, taskId: task.id } });
      if (!item) throw refusalError('invalid_checklist_item');
      await tx.taskChecklistItem.updateMany({
        where: { id: item.id, taskId: task.id },
        data: {
          ...(text !== undefined ? { text } : {}),
          ...(input.done != null ? { done: input.done, doneById: input.done ? actorId : null } : {}),
        },
      });
    });
  }

  async moveChecklistItem(
    scope: TaskScope,
    actorId: string,
    taskId: string,
    itemId: string,
    afterItemId: string | null,
  ): Promise<TaskRow> {
    return this.checklist(scope, actorId, taskId, async (task, tx) => {
      let items = await tx.taskChecklistItem.findMany({
        where: { taskId: task.id },
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      });
      if (!items.some((item) => item.id === itemId)) throw refusalError('invalid_checklist_item');
      let rank = rankAfter(items, itemId, afterItemId);
      if (rank === undefined) throw refusalError('invalid_checklist_item');
      if (rank === null) {
        for (const next of rebalancedRanks(items)) {
          await tx.taskChecklistItem.updateMany({ where: { id: next.id, taskId: task.id }, data: { rank: next.rank } });
        }
        items = await tx.taskChecklistItem.findMany({
          where: { taskId: task.id },
          orderBy: [{ rank: 'asc' }, { id: 'asc' }],
        });
        rank = rankAfter(items, itemId, afterItemId) ?? null;
      }
      await tx.taskChecklistItem.updateMany({ where: { id: itemId, taskId: task.id }, data: { rank: rank ?? 0 } });
    });
  }

  async removeChecklistItem(scope: TaskScope, actorId: string, taskId: string, itemId: string): Promise<TaskRow> {
    return this.checklist(scope, actorId, taskId, async (task, tx) => {
      const gone = await tx.taskChecklistItem.deleteMany({ where: { id: itemId, taskId: task.id } });
      if (gone.count === 0) throw refusalError('invalid_checklist_item');
    });
  }

  // ── archive ───────────────────────────────────────────────────────────────

  async archive(scope: TaskScope, actorId: string, taskId: string): Promise<TaskRow> {
    return (await this.archiveAct(scope, actorId, taskId, 'archive')) as TaskRow;
  }

  async restore(scope: TaskScope, actorId: string, taskId: string): Promise<TaskRow> {
    return (await this.archiveAct(scope, actorId, taskId, 'restore')) as TaskRow;
  }

  /** ⚠ Only from the archive. Its checklist, assignees and comments go with it. */
  async deleteForever(scope: TaskScope, actorId: string, taskId: string): Promise<void> {
    await this.archiveAct(scope, actorId, taskId, 'delete_forever');
  }

  // ── the person's own settings ─────────────────────────────────────────────

  /** Board or list, and the board they last had open. Their own row; nobody else's changes. */
  async setSettings(
    scope: TaskScope,
    actorId: string,
    input: { view: string; lastBoardId?: string | null | undefined },
  ): Promise<TaskSettings> {
    if (!(TASK_VIEWS as readonly string[]).includes(input.view)) throw refusalError('invalid_settings');
    const lastBoardId = input.lastBoardId ?? null;
    if (lastBoardId !== null && !/^[\w-]{1,64}$/u.test(lastBoardId)) throw refusalError('invalid_settings');
    const row = await this.prisma.taskPreference.upsert({
      where: { userId_workspaceId: { userId: actorId, workspaceId: scope.workspaceId } },
      create: { ...scope, userId: actorId, view: input.view, lastBoardId },
      update: { view: input.view, lastBoardId },
    });
    return normalizeTaskSettings(row);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * Whether the actor may set these assignees, the domain's plan checked
   * against the ports:
   *
   *   - adding anybody else needs `task:assign` (`TaskAccessCheck`);
   *   - every newly added person must be one the directory can assign — and
   *     with no directory, only the actor themselves (fail closed).
   */
  private async approveAssignees(
    scope: TaskScope,
    board: TaskBoardRow,
    current: readonly string[],
    next: readonly string[],
    actorId: string,
  ): Promise<{ added: readonly string[]; removed: readonly string[] }> {
    const plan = planSetAssignees(board, current, next, actorId);
    if (plan.kind === 'refused') throw refusalError(plan.reason);
    if (plan.kind === 'needs_assign') {
      const allowed = (await this.access?.holdsAssign(scope.organizationId, scope.workspaceId, actorId)) ?? false;
      if (!allowed) throw refusalError('not_permitted');
    }
    const others = plan.added.filter((userId) => userId !== actorId);
    const selfAdded = plan.added.includes(actorId);
    if (others.length > 0 || selfAdded) {
      const assignable = this.directory
        ? new Set((await this.directory.listAssignable(scope.organizationId, scope.workspaceId)).map((m) => m.userId))
        : new Set([actorId]);
      // The owner of a private board may always be assigned there: the plan
      // already limits a private board's list to them.
      if (board.visibility === 'private') assignable.add(board.ownerId);
      if (plan.added.some((userId) => !assignable.has(userId))) throw refusalError('not_assignable');
    }
    return { added: plan.added, removed: plan.removed };
  }

  private async archiveAct(
    scope: TaskScope,
    actorId: string,
    taskId: string,
    act: TaskArchiveAct,
  ): Promise<TaskRow | null> {
    const { task, board } = await loadTask(this.prisma, scope, taskId, actorId);
    const plan = planTaskArchiveAct(board, task, actorId, act);
    if (plan.kind === 'refused') throw refusalError(plan.reason);
    if (plan.kind === 'needs_manage_all') {
      // ⚠ Unbound means no — fail closed. Only asked about a task on a board the
      // actor can already open, so the answer reveals nothing.
      const allowed = (await this.access?.holdsManageAll(scope.organizationId, scope.workspaceId, actorId)) ?? false;
      if (!allowed) throw refusalError('not_permitted');
    }
    if (act === 'delete_forever') {
      await this.prisma.task.deleteMany({ where: { ...scope, id: task.id } });
      await this.events.changed(board, 'task', actorId, task.id);
      return null;
    }
    await this.prisma.task.updateMany({
      where: { ...scope, id: task.id },
      data: { archivedAt: act === 'archive' ? new Date() : null, updatedById: actorId },
    });
    return this.saved(scope, task.id, actorId);
  }

  /** A small unversioned change (decision 17): `decide` answers the patch, or null for none. */
  private async patch(
    scope: TaskScope,
    actorId: string,
    taskId: string,
    decide: (task: TaskRow) => TaskUpdate | null,
  ): Promise<TaskRow> {
    const { task, board } = await loadTask(this.prisma, scope, taskId, actorId);
    refuse(checkWorkWithTask(board, task, actorId));
    const data = decide(task);
    if (!data) return task;
    await this.prisma.task.updateMany({ where: { ...scope, id: task.id }, data: { ...data, updatedById: actorId } });
    return this.saved(scope, task.id, actorId);
  }

  private async checklist(
    scope: TaskScope,
    actorId: string,
    taskId: string,
    apply: (task: TaskRow, tx: TaskTransaction) => Promise<void>,
  ): Promise<TaskRow> {
    const { task, board } = await loadTask(this.prisma, scope, taskId, actorId);
    refuse(checkWorkWithTask(board, task, actorId));
    await this.prisma.$transaction((tx) => apply(task, tx));
    return this.saved(scope, task.id, actorId);
  }

  /** The task as it now is, read again, and the board it is now on told. */
  private async saved(scope: TaskScope, taskId: string, actorId: string): Promise<TaskRow> {
    const { task, board } = await loadTask(this.prisma, scope, taskId, actorId);
    await this.events.changed(board, 'task', actorId, task.id);
    return task;
  }

  /** After the commit, never failing the write, never telling the actor. */
  private async notifyAssigned(
    board: TaskBoardRow,
    task: TaskRow,
    added: readonly string[],
    actorId: string,
  ): Promise<void> {
    const recipientIds = added.filter((userId) => userId !== actorId);
    if (!this.notifier || recipientIds.length === 0) return;
    await this.notifier
      .assigned({
        recipientIds,
        actorId,
        organizationId: board.organizationId,
        workspaceId: board.workspaceId,
        boardId: board.id,
        boardName: board.name,
        taskId: task.id,
        taskTitle: task.title,
      })
      .catch((error: unknown) =>
        this.logger.warn(`Could not tell people they were assigned: ${(error as Error).message}`),
      );
  }

  /**
   * ⚠ UNBOUND IS THE DECLARED DEFAULT, not module-kit's `NULL_LIMIT_CHECKER`,
   * which allows everything. An unset cap is a floor, never unlimited.
   */
  private async checkCap(scope: TaskScope, actorId: string, current: number): Promise<LimitDecision> {
    if (this.limits) return this.limits.check({ actorId, key: TASK_LIMIT.tasks, current, ...scope });
    const cap = TASK_LIMIT_REGISTRY.find((spec) => spec.key === TASK_LIMIT.tasks)?.defaultValue ?? 0;
    return { allowed: current < cap, limit: cap, current, remaining: Math.max(cap - current, 0) };
  }
}

async function columnsOf(tx: Pick<TaskTransaction, 'taskColumn'>, boardId: string): Promise<TaskColumnRow[]> {
  return tx.taskColumn.findMany({ where: { boardId }, orderBy: [{ rank: 'asc' }, { id: 'asc' }] });
}

/** The live and archived tasks of one column, in order. */
async function columnTasks(
  tx: TaskTransaction,
  scope: TaskScope,
  boardId: string,
  columnId: string,
): Promise<TaskRow[]> {
  return tx.task.findMany({
    where: { ...scope, boardId, columnId },
    orderBy: [{ rank: 'asc' }, { id: 'asc' }],
    take: TASK_BOARD_READ_MAX * 10,
  });
}

/**
 * The rank that lands `taskId` just after `afterTaskId` in the column, or null
 * when there is no room. An anchor that is not in the column is refused.
 */
async function placeInColumn(
  tx: TaskTransaction,
  scope: TaskScope,
  boardId: string,
  columnId: string,
  taskId: string,
  afterTaskId: string | null,
): Promise<number | null> {
  const rank = rankAfter(await columnTasks(tx, scope, boardId, columnId), taskId, afterTaskId);
  if (rank === undefined) throw refusalError('invalid_column');
  return rank;
}

async function rebalanceColumn(
  tx: TaskTransaction,
  scope: TaskScope,
  boardId: string,
  columnId: string,
): Promise<void> {
  for (const { id, rank } of rebalancedRanks(await columnTasks(tx, scope, boardId, columnId))) {
    await tx.task.updateMany({ where: { ...scope, id }, data: { rank } });
  }
}

function sameDay(stored: Date | null, day: TaskDay | null): boolean {
  return taskDayFromDate(stored) === day;
}

function refuse(refusal: TaskRefusal | null): void {
  if (refusal) throw refusalError(refusal);
}

function unwrap<T extends object>(result: T | { refused: TaskRefusal }): T {
  if ('refused' in result) throw refusalError(result.refused);
  return result;
}
