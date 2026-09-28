/**
 * Every GraphQL document this module sends, as data.
 *
 * A document is the ONE part of a typed client that nothing typechecks: a
 * renamed field or a moved argument is a runtime refusal on a screen. Lifted out
 * here, the host hands every one of them to `graphql`'s own validator against
 * the schema it serves — `apps/web-server/test/module-operations.test.ts`.
 *
 * ⚠ FRAMEWORK-FREE, and exported from the package ROOT rather than `/react`, so
 * a server validating them never resolves React to read a string.
 */

const PERSON = 'userId displayName';
const BOARD_SUMMARY = 'id name visibility mine ownerId ownerName version archivedAt';
const BOARD = `${BOARD_SUMMARY} columns { id name done } assignmentsOfOthers`;
const CARD = `id boardId boardName columnId title priority scheduledOn dueOn labels assignees { ${PERSON} } checklistDone checklistTotal commentCount version mine completedAt archivedAt`;
const TASK = `${CARD} description checklist { id text done } creatorId creatorName updatedById updatedByName createdAt updatedAt`;
const COMMENT = 'id taskId authorId authorName body mine editedAt createdAt';
const SETTINGS = 'view lastBoardId';
const SCOPE_VARS = '$organizationId: String!, $workspaceId: String!';
const SCOPE_ARGS = 'organizationId: $organizationId, workspaceId: $workspaceId';

export const TASK_OPERATIONS = {
  // ── boards ────────────────────────────────────────────────────────────────

  /** The boards you can open — live, or the archive. */
  taskBoards: `query TaskBoards(${SCOPE_VARS}, $archived: Boolean) {
    taskBoards(${SCOPE_ARGS}, archived: $archived) { ${BOARD_SUMMARY} }
  }`,

  /** Null for a board that does not exist and for one that is not shared with you alike. */
  taskBoard: `query TaskBoard(${SCOPE_VARS}, $boardId: String!) {
    taskBoard(${SCOPE_ARGS}, boardId: $boardId) { ${BOARD} }
  }`,

  orphanedTaskBoards: `query OrphanedTaskBoards(${SCOPE_VARS}) {
    orphanedTaskBoards(${SCOPE_ARGS}) { id name taskCount }
  }`,

  createTaskBoard: `mutation CreateTaskBoard(${SCOPE_VARS}, $input: CreateTaskBoardInput!) {
    createTaskBoard(${SCOPE_ARGS}, input: $input) { ${BOARD} }
  }`,

  updateTaskBoard: `mutation UpdateTaskBoard(${SCOPE_VARS}, $boardId: String!, $name: String!) {
    updateTaskBoard(${SCOPE_ARGS}, boardId: $boardId, name: $name) { ${BOARD} }
  }`,

  setTaskBoardVisibility: `mutation SetTaskBoardVisibility(${SCOPE_VARS}, $boardId: String!, $visibility: String!) {
    setTaskBoardVisibility(${SCOPE_ARGS}, boardId: $boardId, visibility: $visibility) { ${BOARD} }
  }`,

  addTaskColumn: `mutation AddTaskColumn(${SCOPE_VARS}, $boardId: String!, $name: String!, $done: Boolean, $afterColumnId: String) {
    addTaskColumn(${SCOPE_ARGS}, boardId: $boardId, name: $name, done: $done, afterColumnId: $afterColumnId) { ${BOARD} }
  }`,

  updateTaskColumn: `mutation UpdateTaskColumn(${SCOPE_VARS}, $boardId: String!, $columnId: String!, $input: UpdateTaskColumnInput!) {
    updateTaskColumn(${SCOPE_ARGS}, boardId: $boardId, columnId: $columnId, input: $input) { ${BOARD} }
  }`,

  moveTaskColumn: `mutation MoveTaskColumn(${SCOPE_VARS}, $boardId: String!, $columnId: String!, $afterColumnId: String) {
    moveTaskColumn(${SCOPE_ARGS}, boardId: $boardId, columnId: $columnId, afterColumnId: $afterColumnId) { ${BOARD} }
  }`,

  removeTaskColumn: `mutation RemoveTaskColumn(${SCOPE_VARS}, $boardId: String!, $columnId: String!, $destinationColumnId: String) {
    removeTaskColumn(${SCOPE_ARGS}, boardId: $boardId, columnId: $columnId, destinationColumnId: $destinationColumnId) { ${BOARD} }
  }`,

  archiveTaskBoard: `mutation ArchiveTaskBoard(${SCOPE_VARS}, $boardId: String!) {
    archiveTaskBoard(${SCOPE_ARGS}, boardId: $boardId) { ${BOARD} }
  }`,

  restoreTaskBoard: `mutation RestoreTaskBoard(${SCOPE_VARS}, $boardId: String!) {
    restoreTaskBoard(${SCOPE_ARGS}, boardId: $boardId) { ${BOARD} }
  }`,

  deleteTaskBoardForever: `mutation DeleteTaskBoardForever(${SCOPE_VARS}, $boardId: String!) {
    deleteTaskBoardForever(${SCOPE_ARGS}, boardId: $boardId)
  }`,

  transferTaskBoard: `mutation TransferTaskBoard(${SCOPE_VARS}, $boardId: String!, $newOwnerId: String!) {
    transferTaskBoard(${SCOPE_ARGS}, boardId: $boardId, newOwnerId: $newOwnerId)
  }`,

  // ── tasks ─────────────────────────────────────────────────────────────────

  /** A board's tasks, its columns, and the labels on it. */
  tasks: `query Tasks(${SCOPE_VARS}, $boardId: String!, $filter: TaskFilterInput) {
    tasks(${SCOPE_ARGS}, boardId: $boardId, filter: $filter) {
      board { ${BOARD} }
      tasks { ${CARD} }
      labels
      truncated
    }
  }`,

  task: `query Task(${SCOPE_VARS}, $taskId: String!) {
    task(${SCOPE_ARGS}, taskId: $taskId) { ${TASK} }
  }`,

  myTasks: `query MyTasks(${SCOPE_VARS}) {
    myTasks(${SCOPE_ARGS}) { ${CARD} }
  }`,

  taskAssignableMembers: `query TaskAssignableMembers(${SCOPE_VARS}, $boardId: String!) {
    taskAssignableMembers(${SCOPE_ARGS}, boardId: $boardId) { ${PERSON} }
  }`,

  createTask: `mutation CreateTask(${SCOPE_VARS}, $boardId: String!, $input: CreateTaskInput!) {
    createTask(${SCOPE_ARGS}, boardId: $boardId, input: $input) { ${TASK} }
  }`,

  updateTask: `mutation UpdateTask(${SCOPE_VARS}, $taskId: String!, $expectedVersion: Int!, $input: UpdateTaskInput!) {
    updateTask(${SCOPE_ARGS}, taskId: $taskId, expectedVersion: $expectedVersion, input: $input) { ${TASK} }
  }`,

  /** Omit `afterTaskId` for the top of the column; `boardId` to move it to another board. */
  moveTask: `mutation MoveTask(${SCOPE_VARS}, $taskId: String!, $columnId: String!, $afterTaskId: String, $boardId: String) {
    moveTask(${SCOPE_ARGS}, taskId: $taskId, columnId: $columnId, afterTaskId: $afterTaskId, boardId: $boardId) { ${TASK} }
  }`,

  setTaskDates: `mutation SetTaskDates(${SCOPE_VARS}, $taskId: String!, $scheduledOn: String, $dueOn: String) {
    setTaskDates(${SCOPE_ARGS}, taskId: $taskId, scheduledOn: $scheduledOn, dueOn: $dueOn) { ${TASK} }
  }`,

  setTaskPriority: `mutation SetTaskPriority(${SCOPE_VARS}, $taskId: String!, $priority: String!) {
    setTaskPriority(${SCOPE_ARGS}, taskId: $taskId, priority: $priority) { ${TASK} }
  }`,

  setTaskLabels: `mutation SetTaskLabels(${SCOPE_VARS}, $taskId: String!, $labels: [String!]!) {
    setTaskLabels(${SCOPE_ARGS}, taskId: $taskId, labels: $labels) { ${TASK} }
  }`,

  setTaskAssignees: `mutation SetTaskAssignees(${SCOPE_VARS}, $taskId: String!, $userIds: [String!]!) {
    setTaskAssignees(${SCOPE_ARGS}, taskId: $taskId, userIds: $userIds) { ${TASK} }
  }`,

  addTaskChecklistItem: `mutation AddTaskChecklistItem(${SCOPE_VARS}, $taskId: String!, $text: String!) {
    addTaskChecklistItem(${SCOPE_ARGS}, taskId: $taskId, text: $text) { ${TASK} }
  }`,

  updateTaskChecklistItem: `mutation UpdateTaskChecklistItem(${SCOPE_VARS}, $taskId: String!, $itemId: String!, $text: String, $done: Boolean) {
    updateTaskChecklistItem(${SCOPE_ARGS}, taskId: $taskId, itemId: $itemId, text: $text, done: $done) { ${TASK} }
  }`,

  moveTaskChecklistItem: `mutation MoveTaskChecklistItem(${SCOPE_VARS}, $taskId: String!, $itemId: String!, $afterItemId: String) {
    moveTaskChecklistItem(${SCOPE_ARGS}, taskId: $taskId, itemId: $itemId, afterItemId: $afterItemId) { ${TASK} }
  }`,

  removeTaskChecklistItem: `mutation RemoveTaskChecklistItem(${SCOPE_VARS}, $taskId: String!, $itemId: String!) {
    removeTaskChecklistItem(${SCOPE_ARGS}, taskId: $taskId, itemId: $itemId) { ${TASK} }
  }`,

  archiveTask: `mutation ArchiveTask(${SCOPE_VARS}, $taskId: String!) {
    archiveTask(${SCOPE_ARGS}, taskId: $taskId) { ${TASK} }
  }`,

  restoreTask: `mutation RestoreTask(${SCOPE_VARS}, $taskId: String!) {
    restoreTask(${SCOPE_ARGS}, taskId: $taskId) { ${TASK} }
  }`,

  deleteTaskForever: `mutation DeleteTaskForever(${SCOPE_VARS}, $taskId: String!) {
    deleteTaskForever(${SCOPE_ARGS}, taskId: $taskId)
  }`,

  // ── comments ──────────────────────────────────────────────────────────────

  taskComments: `query TaskComments(${SCOPE_VARS}, $taskId: String!) {
    taskComments(${SCOPE_ARGS}, taskId: $taskId) { ${COMMENT} }
  }`,

  addTaskComment: `mutation AddTaskComment(${SCOPE_VARS}, $taskId: String!, $body: String!) {
    addTaskComment(${SCOPE_ARGS}, taskId: $taskId, body: $body) { ${COMMENT} }
  }`,

  updateTaskComment: `mutation UpdateTaskComment(${SCOPE_VARS}, $commentId: String!, $body: String!) {
    updateTaskComment(${SCOPE_ARGS}, commentId: $commentId, body: $body) { ${COMMENT} }
  }`,

  removeTaskComment: `mutation RemoveTaskComment(${SCOPE_VARS}, $commentId: String!) {
    removeTaskComment(${SCOPE_ARGS}, commentId: $commentId)
  }`,

  // ── the person's own ──────────────────────────────────────────────────────

  myTaskSettings: `query MyTaskSettings(${SCOPE_VARS}) {
    myTaskSettings(${SCOPE_ARGS}) { ${SETTINGS} }
  }`,

  setMyTaskSettings: `mutation SetMyTaskSettings(${SCOPE_VARS}, $settings: TaskSettingsInput!) {
    setMyTaskSettings(${SCOPE_ARGS}, settings: $settings) { ${SETTINGS} }
  }`,

  /** Ids and kinds, never content: read again on `changed`, drop the board on `removed`. */
  taskEvents: `subscription TaskEvents(${SCOPE_VARS}) {
    taskEvents(${SCOPE_ARGS}) { kind boardId taskId actorId }
  }`,
} as const;

export type TaskOperationName = keyof typeof TASK_OPERATIONS;
