import { declareScope, REQUIRED_SCOPE_METADATA, withCatchUp } from '@kwtech/module-kit';
import { Inject, Optional, SetMetadata } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { taskDayFromDate } from '../../domain/dates.js';
import { taskEventFor } from '../../domain/events.js';
import { isTaskPriority } from '../../domain/tasks.js';
import { TaskBoardService, type TaskBoardWithColumns } from '../board.service.js';
import { refusalError, TaskWriteError } from '../task.errors.js';
import type { TaskModuleOptions } from '../task.options.js';
import { NULL_TASK_PUBSUB, TASK_EVENT, type TaskEvent, type TaskPubSub } from '../task.pubsub.js';
import type { TaskBoardRow, TaskCommentRow, TaskRow } from '../task.repository.js';
import { type TaskCard, TaskService } from '../task.service.js';
import { TASK_OPTIONS, TASK_PUBSUB } from '../task.tokens.js';
import { TaskCommentService } from '../task-comment.service.js';
import { TaskWriteService } from '../task-write.service.js';
import {
  CreateTaskBoardInputType,
  CreateTaskInputType,
  OrphanedTaskBoardType,
  TaskBoardSummaryType,
  TaskBoardTasksType,
  TaskBoardType,
  TaskCardType,
  TaskCommentType,
  TaskEventType,
  TaskFilterInputType,
  TaskPersonType,
  TaskSettingsInputType,
  TaskSettingsType,
  TaskType,
  UpdateTaskColumnInputType,
  UpdateTaskInputType,
} from './task.types.js';

type Names = ReadonlyMap<string, string>;

/**
 * The tasks GraphQL surface.
 *
 * ## ⚠ THE SCOPE IS DECLARED ON THE CLASS, and nothing here works without it
 *
 * Every `task:*` key is WORKSPACE level. A resolver has no path, so without a
 * declaration `FeatureGuard` resolves app level — where no workspace key
 * participates — and every key grants nothing to everybody, silently (§12.13).
 * Declared on the CLASS so an operation added later cannot forget it;
 * `surface-coverage.test.ts` fails if it goes. Every operation therefore takes
 * `organizationId` and `workspaceId`.
 *
 * ## Where the guard is, since there is no decorator here
 *
 * Every operation is guarded by its BINDING in `TASK_FEATURE_REGISTRY`.
 *
 * ## And the guard is only half
 *
 * The key says what you may do in this workspace. The services say whether
 * THIS board is one you may open, and whether you own it — by id AND scope,
 * with one answer for "no such board" and "not yours to see".
 */
@SetMetadata(REQUIRED_SCOPE_METADATA, declareScope('workspace'))
@Resolver()
export class TaskResolver {
  constructor(
    private readonly boards: TaskBoardService,
    private readonly tasks: TaskService,
    private readonly writes: TaskWriteService,
    private readonly comments: TaskCommentService,
    @Inject(TASK_OPTIONS) private readonly options: TaskModuleOptions,
    /** Absent means not live: `taskEvents` sends `sync` and ends. */
    @Optional() @Inject(TASK_PUBSUB) private readonly pubsub?: TaskPubSub,
  ) {}

  // ── boards: reading ───────────────────────────────────────────────────────

  @Query(() => [TaskBoardSummaryType], { name: 'taskBoards' })
  async taskBoards(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('archived', { type: () => Boolean, nullable: true }) archived?: boolean | null,
  ): Promise<TaskBoardSummaryType[]> {
    const viewerId = this.actor(gql.req);
    const rows = await this.boards.list({ organizationId, workspaceId }, viewerId, archived ?? false);
    const names = await this.tasks.names(rows.map((row) => row.ownerId));
    return rows.map((row) => renderBoardSummary(row, viewerId, names));
  }

  /** Null for a board that does not exist AND for one the viewer may not open — the same answer. */
  @Query(() => TaskBoardType, { name: 'taskBoard', nullable: true })
  async taskBoard(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('boardId') boardId: string,
  ): Promise<TaskBoardType | null> {
    const viewerId = this.actor(gql.req);
    const found = await this.boards.get({ organizationId, workspaceId }, viewerId, boardId);
    return found ? this.renderBoard(found, viewerId) : null;
  }

  /** Boards whose owner has left — name and size only. Bound to `task:manage_all`. */
  @Query(() => [OrphanedTaskBoardType], { name: 'orphanedTaskBoards' })
  async orphanedTaskBoards(
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<OrphanedTaskBoardType[]> {
    const rows = await this.boards.orphaned({ organizationId, workspaceId });
    return rows.map(({ board, taskCount }) => ({ id: board.id, name: board.name, taskCount }));
  }

  // ── tasks: reading ────────────────────────────────────────────────────────

  /** A board's tasks. Null when the board cannot be opened. */
  @Query(() => TaskBoardTasksType, { name: 'tasks', nullable: true })
  async boardTasks(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('boardId') boardId: string,
    @Args('filter', { type: () => TaskFilterInputType, nullable: true }) filter?: TaskFilterInputType | null,
  ): Promise<TaskBoardTasksType | null> {
    const viewerId = this.actor(gql.req);
    const scope = { organizationId, workspaceId };
    const priority = filter?.priority && isTaskPriority(filter.priority) ? filter.priority : null;
    const read = await this.tasks.board(scope, viewerId, boardId, { ...filter, priority });
    if (!read) return null;
    const names = await this.tasks.names([read.board.ownerId, ...read.tasks.flatMap((card) => card.assigneeIds)]);
    return {
      board: await this.renderBoard({ board: read.board, columns: read.columns }, viewerId, names),
      tasks: read.tasks.map((card) => renderCard(card, read.board, viewerId, names)),
      labels: [...read.labels],
      truncated: read.truncated,
    };
  }

  /** Null for a task that does not exist AND one on a board the viewer cannot open. */
  @Query(() => TaskType, { name: 'task', nullable: true })
  async task(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('taskId') taskId: string,
  ): Promise<TaskType | null> {
    const viewerId = this.actor(gql.req);
    const found = await this.tasks.get({ organizationId, workspaceId }, viewerId, taskId);
    return found ? this.renderTask(found.card, found.board, viewerId) : null;
  }

  /** Live tasks assigned to the viewer, on every board they can open. */
  @Query(() => [TaskCardType], { name: 'myTasks' })
  async myTasks(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<TaskCardType[]> {
    const viewerId = this.actor(gql.req);
    const rows = await this.tasks.myTasks({ organizationId, workspaceId }, viewerId);
    const names = await this.tasks.names(rows.flatMap(({ card }) => card.assigneeIds));
    return rows.map(({ card, board }) => renderCard(card, board, viewerId, names));
  }

  /** Null when the task is not the viewer's to see. */
  @Query(() => [TaskCommentType], { name: 'taskComments', nullable: true })
  async taskComments(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('taskId') taskId: string,
  ): Promise<TaskCommentType[] | null> {
    const viewerId = this.actor(gql.req);
    const rows = await this.tasks.comments({ organizationId, workspaceId }, viewerId, taskId);
    if (!rows) return null;
    const names = await this.tasks.names(rows.map((row) => row.authorId));
    return rows.map((row) => renderComment(row, viewerId, names));
  }

  /** Who may be assigned on this board. Bound to `task:assign`. Null when the board cannot be opened. */
  @Query(() => [TaskPersonType], { name: 'taskAssignableMembers', nullable: true })
  async taskAssignableMembers(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('boardId') boardId: string,
  ): Promise<TaskPersonType[] | null> {
    const members = await this.tasks.assignable({ organizationId, workspaceId }, this.actor(gql.req), boardId);
    return members
      ? members.map((member) => ({ userId: member.userId, displayName: member.displayName || null }))
      : null;
  }

  @Query(() => TaskSettingsType, { name: 'myTaskSettings' })
  async myTaskSettings(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<TaskSettingsType> {
    return this.tasks.settings({ organizationId, workspaceId }, this.actor(gql.req));
  }

  // ── live ──────────────────────────────────────────────────────────────────

  /**
   * Changes on boards the viewer can open, in this workspace.
   *
   * ⚠ FILTERED PER SUBSCRIBER (`taskEventFor`, with the same `canOpenBoard`
   * every query uses): a private board's changes reach its owner and nobody
   * else. Events carry ids, never content. `sync` first, on every
   * (re)subscribe: the engine has no replay.
   */
  @Subscription(() => TaskEventType, {
    name: 'taskEvents',
    // ⚠ REQUIRED: without it GraphQL looks for a `taskEvents` key on the
    // payload, finds none, and delivers `data: null` forever.
    resolve: (payload: TaskEventType) => payload,
  })
  taskEvents(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): AsyncIterableIterator<TaskEventType> {
    const viewer = { userId: this.actor(gql.req), organizationId, workspaceId };
    return withCatchUp<TaskEvent, TaskEventType>({
      live: (this.pubsub ?? NULL_TASK_PUBSUB).asyncIterableIterator<TaskEvent>(TASK_EVENT.changed),
      catchUp: async () => [{ kind: 'sync', boardId: null, taskId: null, actorId: null }],
      transform: (event) => {
        const kind = taskEventFor(event, viewer);
        if (!kind) return null;
        return { kind, boardId: event.boardId, taskId: event.taskId, actorId: event.actorId };
      },
      keyOf: () => null,
    });
  }

  // ── boards: the owner's acts ──────────────────────────────────────────────

  @Mutation(() => TaskBoardType, { name: 'createTaskBoard' })
  async createTaskBoard(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('input', { type: () => CreateTaskBoardInputType }) input: CreateTaskBoardInputType,
  ): Promise<TaskBoardType> {
    const actorId = this.actor(gql.req);
    return this.renderBoard(await this.boards.create({ organizationId, workspaceId }, actorId, { ...input }), actorId);
  }

  @Mutation(() => TaskBoardType, { name: 'updateTaskBoard' })
  async updateTaskBoard(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('boardId') boardId: string,
    @Args('name') name: string,
  ): Promise<TaskBoardType> {
    const actorId = this.actor(gql.req);
    return this.renderBoard(await this.boards.rename({ organizationId, workspaceId }, actorId, boardId, name), actorId);
  }

  /** Making a board private removes everyone else's assignments on it. */
  @Mutation(() => TaskBoardType, { name: 'setTaskBoardVisibility' })
  async setTaskBoardVisibility(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('boardId') boardId: string,
    @Args('visibility') visibility: string,
  ): Promise<TaskBoardType> {
    const actorId = this.actor(gql.req);
    const scope = { organizationId, workspaceId };
    return this.renderBoard(await this.boards.setVisibility(scope, actorId, boardId, visibility), actorId);
  }

  /** Omit `afterColumnId` to add at the end. */
  @Mutation(() => TaskBoardType, { name: 'addTaskColumn' })
  async addTaskColumn(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('boardId') boardId: string,
    @Args('name') name: string,
    @Args('done', { type: () => Boolean, nullable: true }) done?: boolean | null,
    @Args('afterColumnId', { type: () => String, nullable: true }) afterColumnId?: string | null,
  ): Promise<TaskBoardType> {
    const actorId = this.actor(gql.req);
    const scope = { organizationId, workspaceId };
    return this.renderBoard(
      await this.boards.addColumn(scope, actorId, boardId, { name, done, afterColumnId }),
      actorId,
    );
  }

  @Mutation(() => TaskBoardType, { name: 'updateTaskColumn' })
  async updateTaskColumn(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('boardId') boardId: string,
    @Args('columnId') columnId: string,
    @Args('input', { type: () => UpdateTaskColumnInputType }) input: UpdateTaskColumnInputType,
  ): Promise<TaskBoardType> {
    const actorId = this.actor(gql.req);
    const scope = { organizationId, workspaceId };
    return this.renderBoard(await this.boards.updateColumn(scope, actorId, boardId, columnId, { ...input }), actorId);
  }

  /** Omit `afterColumnId` to move it to the start. */
  @Mutation(() => TaskBoardType, { name: 'moveTaskColumn' })
  async moveTaskColumn(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('boardId') boardId: string,
    @Args('columnId') columnId: string,
    @Args('afterColumnId', { type: () => String, nullable: true }) afterColumnId?: string | null,
  ): Promise<TaskBoardType> {
    const actorId = this.actor(gql.req);
    const scope = { organizationId, workspaceId };
    return this.renderBoard(
      await this.boards.moveColumn(scope, actorId, boardId, columnId, afterColumnId ?? null),
      actorId,
    );
  }

  /** Its tasks go to the end of `destinationColumnId`, required when it has any. */
  @Mutation(() => TaskBoardType, { name: 'removeTaskColumn' })
  async removeTaskColumn(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('boardId') boardId: string,
    @Args('columnId') columnId: string,
    @Args('destinationColumnId', { type: () => String, nullable: true }) destinationColumnId?: string | null,
  ): Promise<TaskBoardType> {
    const actorId = this.actor(gql.req);
    const scope = { organizationId, workspaceId };
    return this.renderBoard(
      await this.boards.removeColumn(scope, actorId, boardId, columnId, destinationColumnId ?? null),
      actorId,
    );
  }

  @Mutation(() => TaskBoardType, { name: 'archiveTaskBoard' })
  async archiveTaskBoard(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('boardId') boardId: string,
  ): Promise<TaskBoardType> {
    const actorId = this.actor(gql.req);
    return this.renderBoard(await this.boards.archive({ organizationId, workspaceId }, actorId, boardId), actorId);
  }

  @Mutation(() => TaskBoardType, { name: 'restoreTaskBoard' })
  async restoreTaskBoard(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('boardId') boardId: string,
  ): Promise<TaskBoardType> {
    const actorId = this.actor(gql.req);
    return this.renderBoard(await this.boards.restore({ organizationId, workspaceId }, actorId, boardId), actorId);
  }

  /** ⚠ Only from the archive, and it takes every task on the board with it. */
  @Mutation(() => Boolean, { name: 'deleteTaskBoardForever' })
  async deleteTaskBoardForever(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('boardId') boardId: string,
  ): Promise<boolean> {
    await this.boards.deleteForever({ organizationId, workspaceId }, this.actor(gql.req), boardId);
    return true;
  }

  /** Hand an orphaned board to a member. Bound to `task:manage_all`. */
  @Mutation(() => Boolean, { name: 'transferTaskBoard' })
  async transferTaskBoard(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('boardId') boardId: string,
    @Args('newOwnerId') newOwnerId: string,
  ): Promise<boolean> {
    await this.boards.transfer({ organizationId, workspaceId }, this.actor(gql.req), boardId, newOwnerId);
    return true;
  }

  // ── tasks: writing ────────────────────────────────────────────────────────

  @Mutation(() => TaskType, { name: 'createTask' })
  async createTask(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('boardId') boardId: string,
    @Args('input', { type: () => CreateTaskInputType }) input: CreateTaskInputType,
  ): Promise<TaskType> {
    const actorId = this.actor(gql.req);
    return this.rendered(
      await this.writes.create({ organizationId, workspaceId }, actorId, boardId, { ...input }),
      actorId,
    );
  }

  /** ⚠ From `expectedVersion`. A stale save is refused with `TASK_CONFLICT_MESSAGE`. */
  @Mutation(() => TaskType, { name: 'updateTask' })
  async updateTask(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('taskId') taskId: string,
    @Args('expectedVersion', { type: () => Int }) expectedVersion: number,
    @Args('input', { type: () => UpdateTaskInputType }) input: UpdateTaskInputType,
  ): Promise<TaskType> {
    const actorId = this.actor(gql.req);
    const scope = { organizationId, workspaceId };
    return this.rendered(await this.writes.update(scope, actorId, taskId, expectedVersion, { ...input }), actorId);
  }

  /** Omit `afterTaskId` for the top of the column; pass `boardId` to move it to another board. */
  @Mutation(() => TaskType, { name: 'moveTask' })
  async moveTask(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('taskId') taskId: string,
    @Args('columnId') columnId: string,
    @Args('afterTaskId', { type: () => String, nullable: true }) afterTaskId?: string | null,
    @Args('boardId', { type: () => String, nullable: true }) boardId?: string | null,
  ): Promise<TaskType> {
    const actorId = this.actor(gql.req);
    const scope = { organizationId, workspaceId };
    return this.rendered(await this.writes.move(scope, actorId, taskId, { boardId, columnId, afterTaskId }), actorId);
  }

  /** Both days at once; null clears one. */
  @Mutation(() => TaskType, { name: 'setTaskDates' })
  async setTaskDates(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('taskId') taskId: string,
    @Args('scheduledOn', { type: () => String, nullable: true }) scheduledOn?: string | null,
    @Args('dueOn', { type: () => String, nullable: true }) dueOn?: string | null,
  ): Promise<TaskType> {
    const actorId = this.actor(gql.req);
    const scope = { organizationId, workspaceId };
    return this.rendered(await this.writes.setDates(scope, actorId, taskId, scheduledOn, dueOn), actorId);
  }

  @Mutation(() => TaskType, { name: 'setTaskPriority' })
  async setTaskPriority(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('taskId') taskId: string,
    @Args('priority') priority: string,
  ): Promise<TaskType> {
    const actorId = this.actor(gql.req);
    const scope = { organizationId, workspaceId };
    return this.rendered(await this.writes.setPriority(scope, actorId, taskId, priority), actorId);
  }

  @Mutation(() => TaskType, { name: 'setTaskLabels' })
  async setTaskLabels(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('taskId') taskId: string,
    @Args('labels', { type: () => [String] }) labels: string[],
  ): Promise<TaskType> {
    const actorId = this.actor(gql.req);
    const scope = { organizationId, workspaceId };
    return this.rendered(await this.writes.setLabels(scope, actorId, taskId, labels), actorId);
  }

  /** The whole list. Adding anybody but yourself needs `task:assign`. */
  @Mutation(() => TaskType, { name: 'setTaskAssignees' })
  async setTaskAssignees(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('taskId') taskId: string,
    @Args('userIds', { type: () => [String] }) userIds: string[],
  ): Promise<TaskType> {
    const actorId = this.actor(gql.req);
    const scope = { organizationId, workspaceId };
    return this.rendered(await this.writes.setAssignees(scope, actorId, taskId, userIds), actorId);
  }

  @Mutation(() => TaskType, { name: 'addTaskChecklistItem' })
  async addTaskChecklistItem(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('taskId') taskId: string,
    @Args('text') text: string,
  ): Promise<TaskType> {
    const actorId = this.actor(gql.req);
    const scope = { organizationId, workspaceId };
    return this.rendered(await this.writes.addChecklistItem(scope, actorId, taskId, text), actorId);
  }

  @Mutation(() => TaskType, { name: 'updateTaskChecklistItem' })
  async updateTaskChecklistItem(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('taskId') taskId: string,
    @Args('itemId') itemId: string,
    @Args('text', { type: () => String, nullable: true }) text?: string | null,
    @Args('done', { type: () => Boolean, nullable: true }) done?: boolean | null,
  ): Promise<TaskType> {
    const actorId = this.actor(gql.req);
    const scope = { organizationId, workspaceId };
    return this.rendered(
      await this.writes.updateChecklistItem(scope, actorId, taskId, itemId, { text, done }),
      actorId,
    );
  }

  /** Omit `afterItemId` for the top. */
  @Mutation(() => TaskType, { name: 'moveTaskChecklistItem' })
  async moveTaskChecklistItem(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('taskId') taskId: string,
    @Args('itemId') itemId: string,
    @Args('afterItemId', { type: () => String, nullable: true }) afterItemId?: string | null,
  ): Promise<TaskType> {
    const actorId = this.actor(gql.req);
    const scope = { organizationId, workspaceId };
    return this.rendered(
      await this.writes.moveChecklistItem(scope, actorId, taskId, itemId, afterItemId ?? null),
      actorId,
    );
  }

  @Mutation(() => TaskType, { name: 'removeTaskChecklistItem' })
  async removeTaskChecklistItem(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('taskId') taskId: string,
    @Args('itemId') itemId: string,
  ): Promise<TaskType> {
    const actorId = this.actor(gql.req);
    const scope = { organizationId, workspaceId };
    return this.rendered(await this.writes.removeChecklistItem(scope, actorId, taskId, itemId), actorId);
  }

  @Mutation(() => TaskType, { name: 'archiveTask' })
  async archiveTask(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('taskId') taskId: string,
  ): Promise<TaskType> {
    const actorId = this.actor(gql.req);
    return this.rendered(await this.writes.archive({ organizationId, workspaceId }, actorId, taskId), actorId);
  }

  @Mutation(() => TaskType, { name: 'restoreTask' })
  async restoreTask(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('taskId') taskId: string,
  ): Promise<TaskType> {
    const actorId = this.actor(gql.req);
    return this.rendered(await this.writes.restore({ organizationId, workspaceId }, actorId, taskId), actorId);
  }

  /** ⚠ Only from the archive. */
  @Mutation(() => Boolean, { name: 'deleteTaskForever' })
  async deleteTaskForever(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('taskId') taskId: string,
  ): Promise<boolean> {
    await this.writes.deleteForever({ organizationId, workspaceId }, this.actor(gql.req), taskId);
    return true;
  }

  // ── comments ──────────────────────────────────────────────────────────────

  @Mutation(() => TaskCommentType, { name: 'addTaskComment' })
  async addTaskComment(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('taskId') taskId: string,
    @Args('body') body: string,
  ): Promise<TaskCommentType> {
    const actorId = this.actor(gql.req);
    const row = await this.comments.add({ organizationId, workspaceId }, actorId, taskId, body);
    return renderComment(row, actorId, await this.tasks.names([actorId]));
  }

  @Mutation(() => TaskCommentType, { name: 'updateTaskComment' })
  async updateTaskComment(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('commentId') commentId: string,
    @Args('body') body: string,
  ): Promise<TaskCommentType> {
    const actorId = this.actor(gql.req);
    const row = await this.comments.update({ organizationId, workspaceId }, actorId, commentId, body);
    return renderComment(row, actorId, await this.tasks.names([actorId]));
  }

  @Mutation(() => Boolean, { name: 'removeTaskComment' })
  async removeTaskComment(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('commentId') commentId: string,
  ): Promise<boolean> {
    await this.comments.remove({ organizationId, workspaceId }, this.actor(gql.req), commentId);
    return true;
  }

  // ── the person's own settings ─────────────────────────────────────────────

  @Mutation(() => TaskSettingsType, { name: 'setMyTaskSettings' })
  async setMyTaskSettings(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('settings', { type: () => TaskSettingsInputType }) settings: TaskSettingsInputType,
  ): Promise<TaskSettingsType> {
    return this.writes.setSettings({ organizationId, workspaceId }, this.actor(gql.req), { ...settings });
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async renderBoard(found: TaskBoardWithColumns, viewerId: string, known?: Names): Promise<TaskBoardType> {
    const [names, assignmentsOfOthers] = await Promise.all([
      known ?? this.tasks.names([found.board.ownerId]),
      this.boards.assignmentsOfOthers(found.board, viewerId),
    ]);
    return {
      ...renderBoardSummary(found.board, viewerId, names),
      columns: found.columns.map((column) => ({ id: column.id, name: column.name, done: column.done })),
      assignmentsOfOthers,
    };
  }

  /** A written task as its writer sees it, read again with its board, checklist and names. */
  private async rendered(task: TaskRow, actorId: string): Promise<TaskType> {
    const found = await this.tasks.get(
      { organizationId: task.organizationId, workspaceId: task.workspaceId },
      actorId,
      task.id,
    );
    if (!found) throw refusalError('not_found');
    return this.renderTask(found.card, found.board, actorId);
  }

  private async renderTask(card: TaskCard, board: TaskBoardRow, viewerId: string): Promise<TaskType> {
    const { task } = card;
    const names = await this.tasks.names([task.creatorId, task.updatedById, ...card.assigneeIds]);
    return {
      ...renderCard(card, board, viewerId, names),
      description: task.description,
      checklist: card.checklist.map((item) => ({ id: item.id, text: item.text, done: item.done })),
      creatorId: task.creatorId,
      creatorName: names.get(task.creatorId) ?? null,
      updatedById: task.updatedById,
      updatedByName: names.get(task.updatedById) ?? null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }

  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw new TaskWriteError('not_permitted', 'Not signed in');
    return actorId;
  }
}

function renderBoardSummary(board: TaskBoardRow, viewerId: string, names: Names): TaskBoardSummaryType {
  return {
    id: board.id,
    name: board.name,
    visibility: board.visibility,
    mine: board.ownerId === viewerId,
    ownerId: board.ownerId,
    ownerName: names.get(board.ownerId) ?? null,
    version: board.version,
    archivedAt: board.archivedAt?.toISOString() ?? null,
  };
}

function renderCard(card: TaskCard, board: TaskBoardRow, viewerId: string, names: Names): TaskCardType {
  const { task } = card;
  return {
    id: task.id,
    boardId: task.boardId,
    boardName: board.name,
    columnId: task.columnId,
    title: task.title,
    priority: task.priority,
    scheduledOn: taskDayFromDate(task.scheduledOn),
    dueOn: taskDayFromDate(task.dueOn),
    labels: [...task.labels],
    assignees: card.assigneeIds.map((userId) => ({ userId, displayName: names.get(userId) ?? null })),
    checklistDone: card.checklist.filter((item) => item.done).length,
    checklistTotal: card.checklist.length,
    commentCount: task.commentCount,
    version: task.version,
    mine: task.creatorId === viewerId,
    completedAt: task.completedAt?.toISOString() ?? null,
    archivedAt: task.archivedAt?.toISOString() ?? null,
  };
}

function renderComment(row: TaskCommentRow, viewerId: string, names: Names): TaskCommentType {
  return {
    id: row.id,
    taskId: row.taskId,
    authorId: row.authorId,
    authorName: names.get(row.authorId) ?? null,
    body: row.body,
    mine: row.authorId === viewerId,
    editedAt: row.editedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
