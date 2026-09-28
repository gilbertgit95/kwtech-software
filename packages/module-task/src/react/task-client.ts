'use client';

import { TASK_OPERATIONS, type TaskOperationName } from '../operations.js';

/**
 * How the tasks app reaches the API — through the app's same-origin route
 * handler, which attaches the session. The path is a parameter because that
 * handler belongs to `module-auth`, and this module may not name its URL
 * (PLAN §9). The default is where this app mounts it.
 */
export const DEFAULT_GRAPHQL_PATH = '/api/auth/graphql';

export interface TaskScopeView {
  organizationId: string;
  workspaceId: string;
}

export interface TaskPersonView {
  userId: string;
  /** Null for somebody the app cannot name: a former member. */
  displayName: string | null;
}

export interface TaskColumnView {
  id: string;
  name: string;
  done: boolean;
}

export interface TaskBoardSummaryView {
  id: string;
  name: string;
  /** `private` or `workspace`. */
  visibility: string;
  mine: boolean;
  ownerId: string;
  ownerName: string | null;
  version: number;
  archivedAt: string | null;
}

export interface TaskBoardView extends TaskBoardSummaryView {
  columns: TaskColumnView[];
  /** For the owner of a shared board: how many assignments making it private removes. */
  assignmentsOfOthers: number | null;
}

export interface TaskCardView {
  id: string;
  boardId: string;
  boardName: string;
  columnId: string;
  title: string;
  /** `low`, `normal`, `high` or `urgent`. */
  priority: string;
  /** `YYYY-MM-DD`. */
  scheduledOn: string | null;
  dueOn: string | null;
  labels: string[];
  assignees: TaskPersonView[];
  checklistDone: number;
  checklistTotal: number;
  commentCount: number;
  version: number;
  mine: boolean;
  completedAt: string | null;
  archivedAt: string | null;
}

export interface TaskChecklistItemView {
  id: string;
  text: string;
  done: boolean;
}

export interface TaskView extends TaskCardView {
  description: string;
  checklist: TaskChecklistItemView[];
  creatorId: string;
  creatorName: string | null;
  updatedById: string;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskBoardTasksView {
  board: TaskBoardView;
  tasks: TaskCardView[];
  labels: string[];
  truncated: boolean;
}

export interface TaskCommentView {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string | null;
  body: string;
  mine: boolean;
  editedAt: string | null;
  createdAt: string;
}

export interface TaskSettingsView {
  /** `board` or `list`. */
  view: string;
  lastBoardId: string | null;
}

export interface OrphanedTaskBoardView {
  id: string;
  name: string;
  taskCount: number;
}

export interface TaskEventView {
  /** `sync`, `changed` or `removed`. */
  kind: string;
  boardId: string | null;
  taskId: string | null;
  actorId: string | null;
}

export interface TaskFilterView {
  search?: string | null;
  label?: string | null;
  priority?: string | null;
  assignedToMe?: boolean | null;
  archived?: boolean | null;
}

export interface NewBoardInput {
  name: string;
  visibility: string;
  columns: { name: string; done: boolean }[];
}

export interface NewTaskInput {
  title: string;
  columnId?: string | null;
  assigneeIds?: string[] | null;
}

/** One method per operation, each answering the operation's own result. */
export interface TaskClient {
  boards(scope: TaskScopeView, archived: boolean): Promise<TaskBoardSummaryView[]>;
  board(scope: TaskScopeView, boardId: string, filter: TaskFilterView): Promise<TaskBoardTasksView | null>;
  task(scope: TaskScopeView, taskId: string): Promise<TaskView | null>;
  myTasks(scope: TaskScopeView): Promise<TaskCardView[]>;
  comments(scope: TaskScopeView, taskId: string): Promise<TaskCommentView[] | null>;
  assignable(scope: TaskScopeView, boardId: string): Promise<TaskPersonView[] | null>;
  orphaned(scope: TaskScopeView): Promise<OrphanedTaskBoardView[]>;
  settings(scope: TaskScopeView): Promise<TaskSettingsView>;
  setSettings(scope: TaskScopeView, settings: { view: string; lastBoardId: string | null }): Promise<TaskSettingsView>;

  createBoard(scope: TaskScopeView, input: NewBoardInput): Promise<TaskBoardView>;
  renameBoard(scope: TaskScopeView, boardId: string, name: string): Promise<TaskBoardView>;
  setBoardVisibility(scope: TaskScopeView, boardId: string, visibility: string): Promise<TaskBoardView>;
  addColumn(scope: TaskScopeView, boardId: string, name: string, done: boolean): Promise<TaskBoardView>;
  updateColumn(
    scope: TaskScopeView,
    boardId: string,
    columnId: string,
    input: { name?: string; done?: boolean },
  ): Promise<TaskBoardView>;
  moveColumn(
    scope: TaskScopeView,
    boardId: string,
    columnId: string,
    afterColumnId: string | null,
  ): Promise<TaskBoardView>;
  removeColumn(
    scope: TaskScopeView,
    boardId: string,
    columnId: string,
    destinationColumnId: string | null,
  ): Promise<TaskBoardView>;
  archiveBoard(scope: TaskScopeView, boardId: string): Promise<TaskBoardView>;
  restoreBoard(scope: TaskScopeView, boardId: string): Promise<TaskBoardView>;
  deleteBoardForever(scope: TaskScopeView, boardId: string): Promise<void>;
  transferBoard(scope: TaskScopeView, boardId: string, newOwnerId: string): Promise<void>;

  createTask(scope: TaskScopeView, boardId: string, input: NewTaskInput): Promise<TaskView>;
  updateTask(
    scope: TaskScopeView,
    taskId: string,
    expectedVersion: number,
    input: { title?: string; description?: string },
  ): Promise<TaskView>;
  moveTask(
    scope: TaskScopeView,
    taskId: string,
    move: { columnId: string; afterTaskId: string | null; boardId?: string | null },
  ): Promise<TaskView>;
  setDates(scope: TaskScopeView, taskId: string, scheduledOn: string | null, dueOn: string | null): Promise<TaskView>;
  setPriority(scope: TaskScopeView, taskId: string, priority: string): Promise<TaskView>;
  setLabels(scope: TaskScopeView, taskId: string, labels: string[]): Promise<TaskView>;
  setAssignees(scope: TaskScopeView, taskId: string, userIds: string[]): Promise<TaskView>;
  addChecklistItem(scope: TaskScopeView, taskId: string, text: string): Promise<TaskView>;
  updateChecklistItem(
    scope: TaskScopeView,
    taskId: string,
    itemId: string,
    input: { text?: string; done?: boolean },
  ): Promise<TaskView>;
  moveChecklistItem(
    scope: TaskScopeView,
    taskId: string,
    itemId: string,
    afterItemId: string | null,
  ): Promise<TaskView>;
  removeChecklistItem(scope: TaskScopeView, taskId: string, itemId: string): Promise<TaskView>;
  archiveTask(scope: TaskScopeView, taskId: string): Promise<TaskView>;
  restoreTask(scope: TaskScopeView, taskId: string): Promise<TaskView>;
  deleteTaskForever(scope: TaskScopeView, taskId: string): Promise<void>;
  addComment(scope: TaskScopeView, taskId: string, body: string): Promise<TaskCommentView>;
  updateComment(scope: TaskScopeView, commentId: string, body: string): Promise<TaskCommentView>;
  removeComment(scope: TaskScopeView, commentId: string): Promise<void>;
}

export function createTaskClient(options: { graphqlPath?: string } = {}): TaskClient {
  const path = options.graphqlPath ?? DEFAULT_GRAPHQL_PATH;

  /**
   * One request shape for every call, answering the operation's own field.
   * Throws the API's FIRST error message: the refusals are written for a
   * reader, and two of them — not found and conflict — are what the app
   * compares against.
   */
  async function call<T>(
    operation: TaskOperationName,
    scope: TaskScopeView,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        query: TASK_OPERATIONS[operation],
        variables: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, ...variables },
      }),
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(response.status === 401 ? 'Your session has ended. Sign in again.' : 'Cannot reach the server.');
    }
    const body = (await response.json()) as { data?: Record<string, unknown>; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'The request was refused.');
    if (!body.data || !(operation in body.data)) throw new Error('The server returned no data.');
    return body.data[operation] as T;
  }

  return {
    boards: (scope, archived) => call('taskBoards', scope, { archived }),
    board: (scope, boardId, filter) => call('tasks', scope, { boardId, filter }),
    task: (scope, taskId) => call('task', scope, { taskId }),
    myTasks: (scope) => call('myTasks', scope),
    comments: (scope, taskId) => call('taskComments', scope, { taskId }),
    assignable: (scope, boardId) => call('taskAssignableMembers', scope, { boardId }),
    orphaned: (scope) => call('orphanedTaskBoards', scope),
    settings: (scope) => call('myTaskSettings', scope),
    setSettings: (scope, settings) => call('setMyTaskSettings', scope, { settings }),

    createBoard: (scope, input) => call('createTaskBoard', scope, { input }),
    renameBoard: (scope, boardId, name) => call('updateTaskBoard', scope, { boardId, name }),
    setBoardVisibility: (scope, boardId, visibility) => call('setTaskBoardVisibility', scope, { boardId, visibility }),
    addColumn: (scope, boardId, name, done) => call('addTaskColumn', scope, { boardId, name, done }),
    updateColumn: (scope, boardId, columnId, input) => call('updateTaskColumn', scope, { boardId, columnId, input }),
    moveColumn: (scope, boardId, columnId, afterColumnId) =>
      call('moveTaskColumn', scope, { boardId, columnId, afterColumnId }),
    removeColumn: (scope, boardId, columnId, destinationColumnId) =>
      call('removeTaskColumn', scope, { boardId, columnId, destinationColumnId }),
    archiveBoard: (scope, boardId) => call('archiveTaskBoard', scope, { boardId }),
    restoreBoard: (scope, boardId) => call('restoreTaskBoard', scope, { boardId }),
    deleteBoardForever: async (scope, boardId) => {
      await call('deleteTaskBoardForever', scope, { boardId });
    },
    transferBoard: async (scope, boardId, newOwnerId) => {
      await call('transferTaskBoard', scope, { boardId, newOwnerId });
    },

    createTask: (scope, boardId, input) => call('createTask', scope, { boardId, input }),
    updateTask: (scope, taskId, expectedVersion, input) =>
      call('updateTask', scope, { taskId, expectedVersion, input }),
    moveTask: (scope, taskId, move) => call('moveTask', scope, { taskId, ...move }),
    setDates: (scope, taskId, scheduledOn, dueOn) => call('setTaskDates', scope, { taskId, scheduledOn, dueOn }),
    setPriority: (scope, taskId, priority) => call('setTaskPriority', scope, { taskId, priority }),
    setLabels: (scope, taskId, labels) => call('setTaskLabels', scope, { taskId, labels }),
    setAssignees: (scope, taskId, userIds) => call('setTaskAssignees', scope, { taskId, userIds }),
    addChecklistItem: (scope, taskId, text) => call('addTaskChecklistItem', scope, { taskId, text }),
    updateChecklistItem: (scope, taskId, itemId, input) =>
      call('updateTaskChecklistItem', scope, { taskId, itemId, ...input }),
    moveChecklistItem: (scope, taskId, itemId, afterItemId) =>
      call('moveTaskChecklistItem', scope, { taskId, itemId, afterItemId }),
    removeChecklistItem: (scope, taskId, itemId) => call('removeTaskChecklistItem', scope, { taskId, itemId }),
    archiveTask: (scope, taskId) => call('archiveTask', scope, { taskId }),
    restoreTask: (scope, taskId) => call('restoreTask', scope, { taskId }),
    deleteTaskForever: async (scope, taskId) => {
      await call('deleteTaskForever', scope, { taskId });
    },
    addComment: (scope, taskId, body) => call('addTaskComment', scope, { taskId, body }),
    updateComment: (scope, commentId, body) => call('updateTaskComment', scope, { commentId, body }),
    removeComment: async (scope, commentId) => {
      await call('removeTaskComment', scope, { commentId });
    },
  };
}
