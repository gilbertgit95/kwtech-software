import type { TaskBoardVisibility, TaskPriority } from '../types.js';

/**
 * The slice of a Prisma client this module uses — declared STRUCTURALLY, never
 * imported from a generated one.
 *
 * The module ships `prisma/task.prisma`; the host composes it into its own
 * schema and hands back the client. So this package has no `@prisma/client`
 * dependency. The app's `satisfies-modules.ts` proves its client fits, at
 * compile time.
 *
 * Every argument shape here is one the services actually send, and nothing
 * more: a wider interface is a wider promise the fake in the tests would have
 * to keep.
 *
 * ⚠ EVERY BOARD AND TASK LOOKUP NAMES ITS WORKSPACE AND ORGANIZATION
 * (`InScope`); columns, checklist items and assignees are reached THROUGH a
 * board or task already found that way. There is no `{ id }`-only shape for a
 * board or task to reach for.
 */

type SortOrder = 'asc' | 'desc';

export interface InScope {
  organizationId: string;
  workspaceId: string;
}

export interface TaskBoardRow extends InScope {
  id: string;
  ownerId: string;
  name: string;
  visibility: TaskBoardVisibility;
  version: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskColumnRow extends InScope {
  id: string;
  boardId: string;
  name: string;
  nameKey: string;
  rank: number;
  done: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskRow extends InScope {
  id: string;
  boardId: string;
  columnId: string;
  rank: number;
  creatorId: string;
  title: string;
  description: string;
  priority: TaskPriority;
  /** A `DATE`: midnight UTC of the day (`taskDayFromDate`). */
  scheduledOn: Date | null;
  dueOn: Date | null;
  labels: string[];
  version: number;
  commentCount: number;
  completedAt: Date | null;
  archivedAt: Date | null;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskAssigneeRow extends InScope {
  taskId: string;
  boardId: string;
  userId: string;
  assignedById: string;
  createdAt: Date;
}

export interface TaskChecklistItemRow extends InScope {
  id: string;
  taskId: string;
  text: string;
  done: boolean;
  rank: number;
  doneById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskCommentRow extends InScope {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  editedAt: Date | null;
  createdAt: Date;
}

/** `sent`, `skipped_late` or `no_recipient` — see prisma/task.prisma. */
export type TaskDueReminderOutcome = 'sent' | 'skipped_late' | 'no_recipient';

export interface TaskDueReminderRow extends InScope {
  taskId: string;
  /** A `DATE`: midnight UTC of the day. */
  dueOn: Date;
  outcome: TaskDueReminderOutcome;
  createdAt: Date;
}

export interface TaskPreferenceRow extends InScope {
  userId: string;
  view: string;
  lastBoardId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Live boards, or the archive. */
type ArchivedFilter = null | { not: null };

/** ⚠ The first `OR` is WHO MAY OPEN IT (`canOpenBoard`), in the query itself. */
export interface TaskBoardListWhere extends InScope {
  archivedAt?: ArchivedFilter;
  OR?: Array<{ ownerId: string } | { visibility: TaskBoardVisibility }>;
  ownerId?: { notIn: string[] };
}

type TextMatch = { contains: string; mode: 'insensitive' };

/** ⚠ Always in scope, and always on boards the viewer may open (`boardId`). */
export interface TaskListWhere extends InScope {
  boardId: string | { in: string[] };
  archivedAt?: ArchivedFilter;
  columnId?: string;
  id?: { in: string[] };
  labels?: { has: string };
  priority?: TaskPriority;
  /** The search term, ALREADY escaped (`escapeLikePattern`). */
  OR?: Array<{ title: TextMatch } | { description: TextMatch }>;
}

/**
 * What the due-reminder sweep reads: a workspace's unfinished, live tasks due
 * on one day, on boards that are not archived, ⚠ WITH NO REMINDER FOR THAT DAY
 * YET. The last line is the idempotence, in the query itself: a task dealt
 * with stops matching, so a run never needs to remember where it got to.
 */
export interface TaskDueWhere extends InScope {
  dueOn: Date;
  completedAt: null;
  archivedAt: null;
  board: { archivedAt: null };
  dueReminders: { none: { dueOn: Date } };
}

export interface TaskBoardUpdate {
  name?: string;
  visibility?: TaskBoardVisibility;
  ownerId?: string;
  archivedAt?: Date | null;
  version: { increment: 1 };
}

export interface TaskUpdate {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  scheduledOn?: Date | null;
  dueOn?: Date | null;
  labels?: string[];
  boardId?: string;
  columnId?: string;
  rank?: number;
  completedAt?: Date | null;
  archivedAt?: Date | null;
  updatedById?: string;
  commentCount?: { increment: 1 } | { decrement: 1 };
  version?: { increment: 1 };
}

export interface TaskTransaction {
  taskBoard: {
    /** ⚠ The only way to find one board: by id AND scope. */
    findFirst(args: { where: InScope & { id: string } }): Promise<TaskBoardRow | null>;
    findMany(args: {
      /** The second shape names boards already reached through their tasks, for a reminder's words. */
      where: TaskBoardListWhere | (InScope & { id: { in: string[] } });
      orderBy: Array<{ name: SortOrder } | { createdAt: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<TaskBoardRow[]>;
    /** The per-person count behind `task:boards`. Archived boards included. */
    count(args: { where: InScope & { ownerId: string } }): Promise<number>;
    create(args: {
      data: InScope & { ownerId: string; name: string; visibility: TaskBoardVisibility };
    }): Promise<TaskBoardRow>;
    /** Conditional on the version the decision was made against, where it matters. */
    updateMany(args: {
      where: InScope & { id: string; version?: number };
      data: TaskBoardUpdate;
    }): Promise<{ count: number }>;
    deleteMany(args: { where: InScope & { id: string } }): Promise<{ count: number }>;
  };

  taskColumn: {
    findMany(args: {
      where: { boardId: string | { in: string[] } };
      orderBy: Array<{ rank: SortOrder } | { id: SortOrder }>;
    }): Promise<TaskColumnRow[]>;
    create(args: {
      data: InScope & { boardId: string; name: string; nameKey: string; rank: number; done: boolean };
    }): Promise<TaskColumnRow>;
    updateMany(args: {
      where: { id: string; boardId: string };
      data: { name?: string; nameKey?: string; rank?: number; done?: boolean };
    }): Promise<{ count: number }>;
    deleteMany(args: { where: { id: string; boardId: string } }): Promise<{ count: number }>;
  };

  task: {
    /** ⚠ The only way to find one task: by id AND scope. */
    findFirst(args: { where: InScope & { id: string } }): Promise<TaskRow | null>;
    findMany(args: {
      where: TaskListWhere | TaskDueWhere;
      orderBy: Array<{ columnId: SortOrder } | { rank: SortOrder } | { id: SortOrder } | { dueOn: SortOrder }>;
      take: number;
    }): Promise<TaskRow[]>;
    count(args: {
      where:
        | (InScope & { creatorId: string })
        | (InScope & { boardId: string; archivedAt?: null })
        | { boardId: string; columnId: string }
        | TaskDueWhere;
    }): Promise<number>;
    create(args: {
      data: InScope & {
        boardId: string;
        columnId: string;
        rank: number;
        creatorId: string;
        title: string;
        description: string;
        priority: TaskPriority;
        scheduledOn: Date | null;
        dueOn: Date | null;
        labels: string[];
        completedAt: Date | null;
        updatedById: string;
      };
    }): Promise<TaskRow>;
    /**
     * ⚠ A title or description save is a COMPARE-AND-SET on `version`. Zero rows
     * means somebody saved in between; the caller refuses rather than
     * overwriting what it never saw.
     */
    updateMany(args: {
      where: (InScope & { id: string; version?: number }) | { boardId: string; columnId: string; completedAt?: null };
      data: TaskUpdate;
    }): Promise<{ count: number }>;
    deleteMany(args: { where: InScope & { id: string } }): Promise<{ count: number }>;
  };

  taskAssignee: {
    findMany(args: {
      where: { taskId: string | { in: string[] } } | { workspaceId: string; userId: string };
    }): Promise<TaskAssigneeRow[]>;
    /** How many assignments a board's owner would remove by making it private. */
    count(args: { where: { boardId: string; userId: { not: string } } }): Promise<number>;
    create(args: {
      data: InScope & { taskId: string; boardId: string; userId: string; assignedById: string };
    }): Promise<TaskAssigneeRow>;
    /** Keeps `boardId` in step when a task moves boards. */
    updateMany(args: { where: { taskId: string }; data: { boardId: string } }): Promise<{ count: number }>;
    deleteMany(args: {
      where:
        | { taskId: string; userId: { in: string[] } | { not: string } }
        | { boardId: string; userId: { not: string } };
    }): Promise<{ count: number }>;
  };

  taskChecklistItem: {
    findMany(args: {
      where: { taskId: string | { in: string[] } };
      orderBy: Array<{ rank: SortOrder } | { id: SortOrder }>;
    }): Promise<TaskChecklistItemRow[]>;
    findFirst(args: { where: { id: string; taskId: string } }): Promise<TaskChecklistItemRow | null>;
    count(args: { where: { taskId: string } }): Promise<number>;
    create(args: { data: InScope & { taskId: string; text: string; rank: number } }): Promise<TaskChecklistItemRow>;
    updateMany(args: {
      where: { id: string; taskId: string };
      data: { text?: string; done?: boolean; doneById?: string | null; rank?: number };
    }): Promise<{ count: number }>;
    deleteMany(args: { where: { id: string; taskId: string } }): Promise<{ count: number }>;
  };

  taskComment: {
    /** ⚠ By id AND scope; its task and board are then checked. */
    findFirst(args: { where: InScope & { id: string } }): Promise<TaskCommentRow | null>;
    findMany(args: {
      where: { taskId: string | { in: string[] } };
      orderBy: Array<{ createdAt: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<TaskCommentRow[]>;
    count(args: { where: { taskId: string } }): Promise<number>;
    create(args: { data: InScope & { taskId: string; authorId: string; body: string } }): Promise<TaskCommentRow>;
    updateMany(args: {
      where: InScope & { id: string };
      data: { body: string; editedAt: Date };
    }): Promise<{ count: number }>;
    deleteMany(args: { where: InScope & { id: string } }): Promise<{ count: number }>;
  };

  taskDueReminder: {
    /**
     * ⚠ The claim on one task's reminder for one day. A second create for the
     * same pair raises a unique violation (`P2002`), which the process reads
     * as "somebody else dealt with it" and tells nobody.
     */
    create(args: {
      data: InScope & { taskId: string; dueOn: Date; outcome: TaskDueReminderOutcome };
    }): Promise<TaskDueReminderRow>;
  };

  taskPreference: {
    findUnique(args: {
      where: { userId_workspaceId: { userId: string; workspaceId: string } };
    }): Promise<TaskPreferenceRow | null>;
    upsert(args: {
      where: { userId_workspaceId: { userId: string; workspaceId: string } };
      create: InScope & { userId: string; view: string; lastBoardId: string | null };
      update: { view: string; lastBoardId: string | null };
    }): Promise<TaskPreferenceRow>;
  };
}

/** The read client. The same delegates; a host may bind a replica. */
export type TaskPrismaClient = TaskTransaction;

export interface TaskWriteClient extends TaskTransaction {
  $transaction<T>(fn: (tx: TaskTransaction) => Promise<T>): Promise<T>;
}
