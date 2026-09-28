import { escapeLikePattern } from '@kwtech/module-kit';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { canOpenBoard } from '../domain/access.js';
import { normalizeTaskLabel } from '../domain/labels.js';
import { TASK_COMMENTS_MAX } from '../domain/tasks.js';
import { normalizeTaskLine } from '../domain/text.js';
import type { TaskPriority } from '../types.js';
import { TASK_BOARDS_READ_MAX } from './board.service.js';
import type { TaskMember, TaskMemberDirectory } from './ports.js';
import { findBoard, findTask, openableBy, type TaskScope } from './task.lookup.js';
import type {
  TaskAssigneeRow,
  TaskBoardRow,
  TaskChecklistItemRow,
  TaskColumnRow,
  TaskCommentRow,
  TaskListWhere,
  TaskPrismaClient,
  TaskRow,
} from './task.repository.js';
import { TASK_MEMBER_DIRECTORY, TASK_PRISMA } from './task.tokens.js';

/**
 * How many tasks one board read returns. A board past a thousand live cards is
 * not read as a board any more; the app says the list was cut (`truncated`)
 * rather than pretending it is whole (PLAN §12).
 */
export const TASK_BOARD_READ_MAX = 1000;

/** How many tasks My tasks shows. */
export const TASK_MY_TASKS_MAX = 500;

/** In code points. A search term is a few words, not a paragraph. */
export const TASK_SEARCH_MAX = 100;

export const TASK_VIEWS = ['board', 'list'] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export interface TaskSettings {
  view: TaskView;
  lastBoardId: string | null;
}

export interface TaskListFilter {
  search?: string | null | undefined;
  label?: string | null | undefined;
  priority?: TaskPriority | null | undefined;
  assignedToMe?: boolean | null | undefined;
  archived?: boolean | null | undefined;
}

/** A task with what its card shows: who is on it, and its checklist. */
export interface TaskCard {
  task: TaskRow;
  assigneeIds: readonly string[];
  checklist: readonly TaskChecklistItemRow[];
}

export interface TaskBoardRead {
  board: TaskBoardRow;
  columns: readonly TaskColumnRow[];
  tasks: readonly TaskCard[];
  /** The labels on the board's live tasks, for the filter — only ones the viewer can see. */
  labels: readonly string[];
  /** More tasks matched than `TASK_BOARD_READ_MAX`. */
  truncated: boolean;
}

/**
 * Reading tasks. Every query starts from WHO MAY OPEN WHAT: a board is found by
 * id and scope and then `canOpenBoard`, and a list of boards carries
 * `openableBy` in its `where`. Nothing a viewer may not open is ever read.
 */
@Injectable()
export class TaskService {
  constructor(
    @Inject(TASK_PRISMA) private readonly prisma: TaskPrismaClient,
    /** Unbound: no names, and you can assign only yourself. */
    @Optional() @Inject(TASK_MEMBER_DIRECTORY) private readonly directory?: TaskMemberDirectory,
  ) {}

  /** A board's tasks, column by column in the board's order, or null when it cannot be opened. */
  async board(
    scope: TaskScope,
    viewerId: string,
    boardId: string,
    filter: TaskListFilter = {},
  ): Promise<TaskBoardRead | null> {
    const board = await findBoard(this.prisma, scope, boardId, viewerId);
    if (!board) return null;

    const base: TaskListWhere = { ...scope, boardId: board.id, archivedAt: filter.archived ? { not: null } : null };
    const where: TaskListWhere = { ...base };
    const term = prepareSearch(filter.search);
    if (term) {
      // ⚠ Escaped exactly once: Prisma's `contains` does not escape.
      const pattern = escapeLikePattern(term);
      where.OR = [
        { title: { contains: pattern, mode: 'insensitive' } },
        { description: { contains: pattern, mode: 'insensitive' } },
      ];
    }
    const label = filter.label ? normalizeTaskLabel(filter.label) : null;
    if (label) where.labels = { has: label };
    if (filter.priority) where.priority = filter.priority;
    if (filter.assignedToMe) {
      const mine = await this.prisma.taskAssignee.findMany({
        where: { workspaceId: scope.workspaceId, userId: viewerId },
      });
      where.id = { in: mine.filter((row) => row.boardId === board.id).map((row) => row.taskId) };
    }

    const filtered = term !== null || label !== null || Boolean(filter.priority) || Boolean(filter.assignedToMe);
    const [columns, rows, labelRows] = await Promise.all([
      this.prisma.taskColumn.findMany({ where: { boardId: board.id }, orderBy: [{ rank: 'asc' }, { id: 'asc' }] }),
      this.prisma.task.findMany({
        where,
        orderBy: [{ columnId: 'asc' }, { rank: 'asc' }, { id: 'asc' }],
        take: TASK_BOARD_READ_MAX + 1,
      }),
      filtered
        ? this.prisma.task.findMany({
            where: { ...scope, boardId: board.id, archivedAt: null },
            orderBy: [{ id: 'asc' }],
            take: TASK_BOARD_READ_MAX,
          })
        : Promise.resolve(null),
    ]);

    const page = rows.slice(0, TASK_BOARD_READ_MAX);
    return {
      board,
      columns,
      tasks: await this.cards(page),
      labels: distinctLabels(labelRows ?? (filter.archived ? [] : page)),
      truncated: rows.length > TASK_BOARD_READ_MAX,
    };
  }

  /** One task with its checklist, or null — for one that does not exist AND one on a board the viewer cannot open. */
  async get(
    scope: TaskScope,
    viewerId: string,
    taskId: string,
  ): Promise<{ card: TaskCard; board: TaskBoardRow; column: TaskColumnRow | null } | null> {
    const found = await findTask(this.prisma, scope, taskId, viewerId);
    if (!found) return null;
    const [[card], columns] = await Promise.all([
      this.cards([found.task]),
      this.prisma.taskColumn.findMany({ where: { boardId: found.board.id }, orderBy: [{ rank: 'asc' }] }),
    ]);
    if (!card) return null;
    return { card, board: found.board, column: columns.find((column) => column.id === found.task.columnId) ?? null };
  }

  /**
   * Live tasks assigned to the viewer, on live boards they can still open,
   * with each one's board — My tasks (§6). Grouped by day in the app, which
   * knows the viewer's calendar date.
   */
  async myTasks(scope: TaskScope, viewerId: string): Promise<Array<{ card: TaskCard; board: TaskBoardRow }>> {
    const assigned = await this.prisma.taskAssignee.findMany({
      where: { workspaceId: scope.workspaceId, userId: viewerId },
    });
    if (assigned.length === 0) return [];
    const boards = await this.prisma.taskBoard.findMany({
      where: { ...scope, archivedAt: null, OR: openableBy(viewerId) },
      orderBy: [{ name: 'asc' }],
      take: TASK_BOARDS_READ_MAX,
    });
    const open = new Map(boards.filter((board) => canOpenBoard(board, viewerId)).map((board) => [board.id, board]));
    const rows = await this.prisma.task.findMany({
      where: {
        ...scope,
        boardId: { in: [...open.keys()] },
        archivedAt: null,
        id: { in: assigned.map((row) => row.taskId) },
      },
      orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
      take: TASK_MY_TASKS_MAX,
    });
    const cards = await this.cards(rows);
    return cards.flatMap((card) => {
      const board = open.get(card.task.boardId);
      return board ? [{ card, board }] : [];
    });
  }

  /** A task's comments, oldest first, or null when the task cannot be seen. */
  async comments(scope: TaskScope, viewerId: string, taskId: string): Promise<TaskCommentRow[] | null> {
    const found = await findTask(this.prisma, scope, taskId, viewerId);
    if (!found) return null;
    return this.prisma.taskComment.findMany({
      where: { taskId: found.task.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: TASK_COMMENTS_MAX,
    });
  }

  /**
   * Who may be assigned on this board (decision 10): on a private board, its
   * owner; otherwise the directory's active members holding `task:write`.
   * Unbound directory: only the viewer themselves. Null when the board cannot
   * be opened.
   */
  async assignable(scope: TaskScope, viewerId: string, boardId: string): Promise<readonly TaskMember[] | null> {
    const board = await findBoard(this.prisma, scope, boardId, viewerId);
    if (!board) return null;
    if (board.visibility === 'private') return this.describeAll([board.ownerId]);
    if (!this.directory) return this.describeAll([viewerId]);
    return this.directory.listAssignable(scope.organizationId, scope.workspaceId);
  }

  async settings(scope: TaskScope, viewerId: string): Promise<TaskSettings> {
    const row = await this.prisma.taskPreference.findUnique({
      where: { userId_workspaceId: { userId: viewerId, workspaceId: scope.workspaceId } },
    });
    return normalizeTaskSettings(row);
  }

  /** Display names for these ids. Unknown ids — and every id when unbound — are left out. */
  async names(userIds: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    if (!this.directory || unique.length === 0) return new Map();
    const members = await this.directory.describe(unique);
    return new Map(members.map((member) => [member.userId, member.displayName]));
  }

  /** Assignees and checklists for a page of tasks, in two reads. */
  async cards(rows: readonly TaskRow[]): Promise<TaskCard[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [assignees, items] = await Promise.all([
      this.prisma.taskAssignee.findMany({ where: { taskId: { in: ids } } }),
      this.prisma.taskChecklistItem.findMany({
        where: { taskId: { in: ids } },
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const byTask = <T extends { taskId: string }>(list: readonly T[]) => {
      const map = new Map<string, T[]>();
      for (const row of list) map.set(row.taskId, [...(map.get(row.taskId) ?? []), row]);
      return map;
    };
    const assigneeMap = byTask<TaskAssigneeRow>(assignees);
    const itemMap = byTask<TaskChecklistItemRow>(items);
    return rows.map((task) => ({
      task,
      assigneeIds: (assigneeMap.get(task.id) ?? [])
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((row) => row.userId),
      checklist: itemMap.get(task.id) ?? [],
    }));
  }

  private async describeAll(userIds: readonly string[]): Promise<TaskMember[]> {
    const names = await this.names(userIds);
    return userIds.map((userId) => ({ userId, displayName: names.get(userId) ?? '' }));
  }
}

/** A stored preference, or the defaults — a value no longer offered reads back as its default. */
export function normalizeTaskSettings(row: { view: string; lastBoardId: string | null } | null): TaskSettings {
  const view = (TASK_VIEWS as readonly string[]).includes(row?.view ?? '') ? (row?.view as TaskView) : 'board';
  return { view, lastBoardId: row?.lastBoardId ?? null };
}

/** The term to search for, or null for no search. Cut rather than refused: a search box is not a form. */
export function prepareSearch(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const term = normalizeTaskLine(raw);
  return term.length === 0 ? null : [...term].slice(0, TASK_SEARCH_MAX).join('');
}

function distinctLabels(rows: readonly TaskRow[]): string[] {
  return [...new Set(rows.flatMap((row) => row.labels))].sort();
}
