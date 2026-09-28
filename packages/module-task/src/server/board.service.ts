import type { LimitChecker, LimitDecision } from '@kwtech/module-kit';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { checkBoardLifecycle, checkConfigureBoard, isTaskBoardVisibility } from '../domain/access.js';
import {
  checkAddColumn,
  checkColumnNameFree,
  checkRemoveColumn,
  checkSetColumnDone,
  columnNameKey,
  prepareBoardName,
  prepareColumnName,
  prepareInitialColumns,
  TASK_DEFAULT_COLUMNS,
} from '../domain/boards.js';
import type { TaskChange } from '../domain/events.js';
import { rankAfter, rankBetween, rebalancedRanks } from '../domain/rank.js';
import { TASK_LIMIT, TASK_LIMIT_REGISTRY } from '../feature-keys.js';
import type { TaskBoardVisibility, TaskRefusal } from '../types.js';
import type { TaskMemberDirectory } from './ports.js';
import { refusalError, TaskWriteError, taskNotFound } from './task.errors.js';
import { TaskEventPublisher } from './task.events.js';
import { findBoard, loadBoard, openableBy, type TaskScope } from './task.lookup.js';
import type { TaskBoardRow, TaskColumnRow, TaskTransaction, TaskWriteClient } from './task.repository.js';
import { TASK_LIMIT_CHECKER, TASK_MEMBER_DIRECTORY, TASK_PRISMA_WRITE } from './task.tokens.js';

/** How many boards one list reads. Twenty per person is the default cap, so this is generous. */
export const TASK_BOARDS_READ_MAX = 500;

/** A board and its columns, in order — what every board read and write answers with. */
export interface TaskBoardWithColumns {
  board: TaskBoardRow;
  columns: readonly TaskColumnRow[];
}

export interface CreateBoardInput {
  name: string;
  /** A string off the wire, checked by `isTaskBoardVisibility`. Default: shared. */
  visibility?: string | null | undefined;
  /** Omitted: `TASK_DEFAULT_COLUMNS`. The creator's own otherwise (decision 6). */
  columns?: readonly { name: string; done?: boolean | null }[] | null | undefined;
}

/**
 * Boards and their columns: reading them, and everything their OWNER does.
 *
 * Each write: find the board BY ID AND SCOPE, ask the domain whether this
 * person may (`checkConfigureBoard` — the owner, on a live board), write, then
 * publish after the commit.
 */
@Injectable()
export class TaskBoardService {
  constructor(
    @Inject(TASK_PRISMA_WRITE) private readonly prisma: TaskWriteClient,
    private readonly events: TaskEventPublisher,
    /** Unbound: the declared default cap. */
    @Optional() @Inject(TASK_LIMIT_CHECKER) private readonly limits?: LimitChecker,
    /** Unbound: nobody can tell an owner has left, so no board is orphaned. */
    @Optional() @Inject(TASK_MEMBER_DIRECTORY) private readonly directory?: TaskMemberDirectory,
  ) {}

  // ── reading ───────────────────────────────────────────────────────────────

  /** The boards this person may open, live or archived, by name. */
  async list(scope: TaskScope, viewerId: string, archived = false): Promise<TaskBoardRow[]> {
    return this.prisma.taskBoard.findMany({
      where: { ...scope, archivedAt: archived ? { not: null } : null, OR: openableBy(viewerId) },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: TASK_BOARDS_READ_MAX,
    });
  }

  /** One board with its columns, or null — for one that does not exist AND one the viewer may not open. */
  async get(scope: TaskScope, viewerId: string, boardId: string): Promise<TaskBoardWithColumns | null> {
    const board = await findBoard(this.prisma, scope, boardId, viewerId);
    return board ? { board, columns: await this.columns(board.id) } : null;
  }

  /**
   * How many assignments of OTHER people making this board private would
   * remove — what the owner is told before they confirm (decision 8). Null for
   * anybody but the owner of a shared board.
   */
  async assignmentsOfOthers(board: TaskBoardRow, viewerId: string): Promise<number | null> {
    if (board.ownerId !== viewerId || board.visibility !== 'workspace') return null;
    return this.prisma.taskAssignee.count({ where: { boardId: board.id, userId: { not: board.ownerId } } });
  }

  /**
   * Boards whose owner is no longer an active member — ALL of them, private
   * ones included, because this is how a team's board is never stranded
   * (TASK-PLAN §0 C). Bound to `task:manage_all`.
   *
   * ⚠ NAME AND SIZE ONLY. The resolver renders nothing else of a board it did
   * not open through `canOpenBoard`: taking over a private board is allowed,
   * reading it first is not.
   */
  async orphaned(scope: TaskScope): Promise<Array<{ board: TaskBoardRow; taskCount: number }>> {
    if (!this.directory) return [];
    const boards = await this.prisma.taskBoard.findMany({
      where: { ...scope },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: TASK_BOARDS_READ_MAX,
    });
    const owners = [...new Set(boards.map((board) => board.ownerId))];
    const active = await this.directory.activeMembers(scope.organizationId, scope.workspaceId, owners);
    const orphans = boards.filter((board) => !active.has(board.ownerId));
    return Promise.all(
      orphans.map(async (board) => ({
        board,
        taskCount: await this.prisma.task.count({ where: { ...scope, boardId: board.id } }),
      })),
    );
  }

  // ── the owner's acts ──────────────────────────────────────────────────────

  /**
   * A new board, owned by its creator, with the columns they made.
   *
   * ⚠ THE CAP IS COUNTED IN THE TRANSACTION THAT INSERTS, per person and
   * archived boards included.
   */
  async create(scope: TaskScope, actorId: string, input: CreateBoardInput): Promise<TaskBoardWithColumns> {
    const { name } = unwrap(prepareBoardName(input.name));
    const visibility = input.visibility ?? 'workspace';
    if (!isTaskBoardVisibility(visibility)) throw refusalError('invalid_visibility');
    const { columns } = unwrap(
      prepareInitialColumns(
        (input.columns ?? TASK_DEFAULT_COLUMNS).map((column) => ({ name: column.name, done: column.done ?? false })),
      ),
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const current = await tx.taskBoard.count({ where: { ...scope, ownerId: actorId } });
      const decision = await this.checkCap(scope, actorId, TASK_LIMIT.boards, current);
      if (!decision.allowed) {
        throw new TaskWriteError('limit_reached', `You can own ${decision.limit} boards here, counting archived ones`, {
          limit: decision.limit,
        });
      }
      const board = await tx.taskBoard.create({ data: { ...scope, ownerId: actorId, name, visibility } });
      let rank: number | null = null;
      for (const column of columns) {
        rank = rankBetween(rank, null);
        await tx.taskColumn.create({
          data: {
            ...scope,
            boardId: board.id,
            name: column.name,
            nameKey: columnNameKey(column.name),
            rank: rank ?? 0,
            done: column.done,
          },
        });
      }
      return board;
    });

    await this.events.changed(created, 'board', actorId);
    return { board: created, columns: await this.columns(created.id) };
  }

  async rename(scope: TaskScope, actorId: string, boardId: string, rawName: string): Promise<TaskBoardWithColumns> {
    const { name } = unwrap(prepareBoardName(rawName));
    return this.configure(scope, actorId, boardId, async (board, tx) => {
      if (name === board.name) return null;
      await tx.taskBoard.updateMany({ where: { ...scope, id: board.id }, data: { name, version: { increment: 1 } } });
      return 'board';
    });
  }

  /**
   * Private or shared (decision 8). Making it private removes every assignment
   * but the owner's, in the same transaction, and tells everyone else to drop
   * the board (`hidden`). Their comments stay.
   */
  async setVisibility(
    scope: TaskScope,
    actorId: string,
    boardId: string,
    visibility: string,
  ): Promise<TaskBoardWithColumns> {
    if (!isTaskBoardVisibility(visibility)) throw refusalError('invalid_visibility');
    return this.configure(scope, actorId, boardId, async (board, tx) => {
      if (visibility === board.visibility) return null;
      await tx.taskBoard.updateMany({
        where: { ...scope, id: board.id },
        data: { visibility: visibility as TaskBoardVisibility, version: { increment: 1 } },
      });
      if (visibility === 'private') {
        await tx.taskAssignee.deleteMany({ where: { boardId: board.id, userId: { not: board.ownerId } } });
        return 'hidden';
      }
      return 'board';
    });
  }

  /** A new column, after `afterColumnId` — or at the end when it is null. */
  async addColumn(
    scope: TaskScope,
    actorId: string,
    boardId: string,
    input: { name: string; done?: boolean | null | undefined; afterColumnId?: string | null | undefined },
  ): Promise<TaskBoardWithColumns> {
    const { name } = unwrap(prepareColumnName(input.name));
    return this.configure(scope, actorId, boardId, async (board, tx) => {
      let columns = await this.columns(board.id, tx);
      refuse(checkAddColumn(columns, name));
      const after = input.afterColumnId ?? columns[columns.length - 1]?.id ?? null;
      let rank = placeAfter(columns, '', after);
      if (rank === null) {
        columns = await this.rebalanceColumns(board.id, columns, tx);
        rank = placeAfter(columns, '', after);
      }
      await tx.taskColumn.create({
        data: {
          ...scope,
          boardId: board.id,
          name,
          nameKey: columnNameKey(name),
          rank: rank ?? 0,
          done: input.done ?? false,
        },
      });
      return 'board';
    });
  }

  /**
   * Rename a column, or mark or unmark it as done. Marking it done FINISHES the
   * tasks in it (`completedAt` set on those without one); unmarking un-finishes
   * them — the column means something else now.
   */
  async updateColumn(
    scope: TaskScope,
    actorId: string,
    boardId: string,
    columnId: string,
    input: { name?: string | null | undefined; done?: boolean | null | undefined },
  ): Promise<TaskBoardWithColumns> {
    const name = input.name == null ? null : unwrap(prepareColumnName(input.name)).name;
    return this.configure(scope, actorId, boardId, async (board, tx) => {
      const columns = await this.columns(board.id, tx);
      const column = columns.find((candidate) => candidate.id === columnId);
      if (!column) throw refusalError('invalid_column');
      const data: { name?: string; nameKey?: string; done?: boolean } = {};

      if (name !== null && name !== column.name) {
        refuse(checkColumnNameFree(columns, name, column.id));
        data.name = name;
        data.nameKey = columnNameKey(name);
      }
      if (input.done != null && input.done !== column.done) {
        refuse(checkSetColumnDone(columns, column.id, input.done));
        data.done = input.done;
        await tx.task.updateMany(
          input.done
            ? {
                where: { boardId: board.id, columnId: column.id, completedAt: null },
                data: { completedAt: new Date() },
              }
            : { where: { boardId: board.id, columnId: column.id }, data: { completedAt: null } },
        );
      }
      if (Object.keys(data).length === 0) return null;
      await tx.taskColumn.updateMany({ where: { id: column.id, boardId: board.id }, data });
      await tx.taskBoard.updateMany({ where: { ...scope, id: board.id }, data: { version: { increment: 1 } } });
      return 'board';
    });
  }

  /** Move a column to just after another — or to the start when `afterColumnId` is null. */
  async moveColumn(
    scope: TaskScope,
    actorId: string,
    boardId: string,
    columnId: string,
    afterColumnId: string | null,
  ): Promise<TaskBoardWithColumns> {
    return this.configure(scope, actorId, boardId, async (board, tx) => {
      let columns = await this.columns(board.id, tx);
      if (!columns.some((column) => column.id === columnId)) throw refusalError('invalid_column');
      let rank = placeAfter(columns, columnId, afterColumnId);
      if (rank === null) {
        columns = await this.rebalanceColumns(board.id, columns, tx);
        rank = placeAfter(columns, columnId, afterColumnId);
      }
      await tx.taskColumn.updateMany({ where: { id: columnId, boardId: board.id }, data: { rank: rank ?? 0 } });
      await tx.taskBoard.updateMany({ where: { ...scope, id: board.id }, data: { version: { increment: 1 } } });
      return 'board';
    });
  }

  /**
   * Remove a column (decision 7). Its tasks — archived ones too — go to the
   * END of `destinationColumnId`, in their order, finished or not by where
   * they land.
   */
  async removeColumn(
    scope: TaskScope,
    actorId: string,
    boardId: string,
    columnId: string,
    destinationColumnId: string | null,
  ): Promise<TaskBoardWithColumns> {
    return this.configure(scope, actorId, boardId, async (board, tx) => {
      const columns = await this.columns(board.id, tx);
      const count = await tx.task.count({ where: { boardId: board.id, columnId } });
      refuse(checkRemoveColumn(columns, columnId, destinationColumnId, count));

      const destination = columns.find((column) => column.id === destinationColumnId);
      if (count > 0 && destination) {
        const moving = await tx.task.findMany({
          where: { ...scope, boardId: board.id, columnId },
          orderBy: [{ rank: 'asc' }, { id: 'asc' }],
          take: count,
        });
        const [last] = await tx.task.findMany({
          where: { ...scope, boardId: board.id, columnId: destination.id },
          orderBy: [{ rank: 'desc' }, { id: 'desc' }],
          take: 1,
        });
        let rank = last?.rank ?? null;
        const now = new Date();
        for (const task of moving) {
          rank = rankBetween(rank, null);
          await tx.task.updateMany({
            where: { ...scope, id: task.id },
            data: {
              columnId: destination.id,
              rank: rank ?? 0,
              completedAt: destination.done ? (task.completedAt ?? now) : null,
            },
          });
        }
      }
      await tx.taskColumn.deleteMany({ where: { id: columnId, boardId: board.id } });
      await tx.taskBoard.updateMany({ where: { ...scope, id: board.id }, data: { version: { increment: 1 } } });
      return 'board';
    });
  }

  async archive(scope: TaskScope, actorId: string, boardId: string): Promise<TaskBoardWithColumns> {
    return this.lifecycle(scope, actorId, boardId, 'archive');
  }

  async restore(scope: TaskScope, actorId: string, boardId: string): Promise<TaskBoardWithColumns> {
    return this.lifecycle(scope, actorId, boardId, 'restore');
  }

  /** ⚠ Only from the archive. Its columns, tasks, checklists and comments go with it. */
  async deleteForever(scope: TaskScope, actorId: string, boardId: string): Promise<void> {
    const board = await loadBoard(this.prisma, scope, boardId, actorId);
    refuse(checkBoardLifecycle(board, actorId, 'delete_forever'));
    await this.prisma.taskBoard.deleteMany({ where: { ...scope, id: board.id } });
    await this.events.changed(board, 'deleted', actorId);
  }

  /**
   * Hand a board whose owner has LEFT to somebody who works here
   * (TASK-PLAN §0 C). Bound to `task:manage_all`; the guard has asked.
   *
   * ⚠ Only an orphaned board, and only to someone the directory can assign:
   * this is not a way for an admin to take a living member's board.
   */
  async transfer(scope: TaskScope, actorId: string, boardId: string, newOwnerId: string): Promise<void> {
    if (!this.directory) throw refusalError('not_permitted');
    // Found by id and scope WITHOUT `canOpenBoard`: the caller may not be able
    // to open it, which is the point. Nothing of it is returned to them.
    const board = await this.prisma.taskBoard.findFirst({ where: { ...scope, id: boardId } });
    if (!board) throw taskNotFound();
    const active = await this.directory.activeMembers(scope.organizationId, scope.workspaceId, [board.ownerId]);
    if (active.has(board.ownerId)) throw taskNotFound();
    const candidates = await this.directory.listAssignable(scope.organizationId, scope.workspaceId);
    if (!candidates.some((member) => member.userId === newOwnerId)) throw refusalError('not_assignable');

    await this.prisma.taskBoard.updateMany({
      where: { ...scope, id: board.id, version: board.version },
      data: { ownerId: newOwnerId, version: { increment: 1 } },
    });
    const moved = await this.prisma.taskBoard.findFirst({ where: { ...scope, id: board.id } });
    if (moved) await this.events.changed(moved, 'board', actorId);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  async columns(boardId: string, client: Pick<TaskTransaction, 'taskColumn'> = this.prisma): Promise<TaskColumnRow[]> {
    return client.taskColumn.findMany({ where: { boardId }, orderBy: [{ rank: 'asc' }, { id: 'asc' }] });
  }

  /**
   * An owner's change: the board found by id and scope, `checkConfigureBoard`,
   * the change in one transaction, then the event. `apply` answers what
   * changed, or null for nothing.
   */
  private async configure(
    scope: TaskScope,
    actorId: string,
    boardId: string,
    apply: (board: TaskBoardRow, tx: TaskTransaction) => Promise<TaskChange | null>,
  ): Promise<TaskBoardWithColumns> {
    const change = await this.prisma.$transaction(async (tx) => {
      const board = await loadBoard(tx, scope, boardId, actorId);
      refuse(checkConfigureBoard(board, actorId));
      return apply(board, tx);
    });
    const board = await loadBoard(this.prisma, scope, boardId, actorId);
    if (change) await this.events.changed(board, change, actorId);
    return { board, columns: await this.columns(board.id) };
  }

  private async lifecycle(
    scope: TaskScope,
    actorId: string,
    boardId: string,
    act: 'archive' | 'restore',
  ): Promise<TaskBoardWithColumns> {
    const board = await loadBoard(this.prisma, scope, boardId, actorId);
    refuse(checkBoardLifecycle(board, actorId, act));
    await this.prisma.taskBoard.updateMany({
      where: { ...scope, id: board.id },
      data: { archivedAt: act === 'archive' ? new Date() : null, version: { increment: 1 } },
    });
    const saved = await loadBoard(this.prisma, scope, boardId, actorId);
    await this.events.changed(saved, 'board', actorId);
    return { board: saved, columns: await this.columns(saved.id) };
  }

  private async rebalanceColumns(
    boardId: string,
    columns: readonly TaskColumnRow[],
    tx: TaskTransaction,
  ): Promise<TaskColumnRow[]> {
    for (const { id, rank } of rebalancedRanks(columns)) {
      await tx.taskColumn.updateMany({ where: { id, boardId }, data: { rank } });
    }
    return this.columns(boardId, tx);
  }

  /**
   * ⚠ UNBOUND IS THE DECLARED DEFAULT, not module-kit's `NULL_LIMIT_CHECKER`,
   * which allows everything. An unset cap is a floor, never unlimited.
   */
  private async checkCap(scope: TaskScope, actorId: string, key: string, current: number): Promise<LimitDecision> {
    if (this.limits) return this.limits.check({ actorId, key, current, ...scope });
    const cap = TASK_LIMIT_REGISTRY.find((spec) => spec.key === key)?.defaultValue ?? 0;
    return { allowed: current < cap, limit: cap, current, remaining: Math.max(cap - current, 0) };
  }
}

/** The rank that puts `movingId` after `afterId` among the columns; throws on an unknown anchor. */
function placeAfter(columns: readonly TaskColumnRow[], movingId: string, afterId: string | null): number | null {
  const rank = rankAfter(columns, movingId, afterId);
  if (rank === undefined) throw refusalError('invalid_column');
  return rank;
}

function refuse(refusal: TaskRefusal | null): void {
  if (refusal) throw refusalError(refusal);
}

function unwrap<T extends object>(result: T | { refused: TaskRefusal }): T {
  if ('refused' in result) throw refusalError(result.refused);
  return result;
}
