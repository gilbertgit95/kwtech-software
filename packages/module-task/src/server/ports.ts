/**
 * The questions this module needs answered and cannot answer itself.
 *
 * Grants belong to `module-permissions`, names to `module-auth`, and telling
 * people things to `module-notification` — and a module may not import a
 * module (PLAN §9). So each is a structural port the APP fills, and each
 * absence has a documented MEANING rather than a crash.
 */

/**
 * Does this person hold `task:assign` / `task:manage_all` in this workspace —
 * after the plan filter, exactly as the guard would resolve it?
 *
 * ⚠ ASKED ONLY WHEN IT DECIDES SOMETHING: assigning somebody else, or deleting
 * somebody else's task or comment. Never on a read path.
 *
 * ⚠ UNBOUND MEANS NO to both. You assign only yourself and delete only your
 * own. Fail closed.
 */
export interface TaskAccessCheck {
  holdsAssign(organizationId: string, workspaceId: string, userId: string): Promise<boolean>;
  holdsManageAll(organizationId: string, workspaceId: string, userId: string): Promise<boolean>;
}

export interface TaskMember {
  userId: string;
  displayName: string;
}

/**
 * Who works here: the people a task may be assigned to, and names.
 *
 * `listAssignable` is ACTIVE members of the workspace who hold `task:write`
 * there — the queue's `QueueStaffDirectory` shape. `describe` names anybody,
 * former members included; an id it does not know is left out, and the app
 * says "a former member".
 *
 * ⚠ UNBOUND MEANS YOU CAN ASSIGN ONLY YOURSELF, and nobody has a name. It also
 * means no board is ever "orphaned": without a directory nobody can tell that
 * an owner has left.
 */
export interface TaskMemberDirectory {
  listAssignable(organizationId: string, workspaceId: string): Promise<readonly TaskMember[]>;
  /**
   * Which of these people are still ACTIVE members of the workspace. A board
   * whose owner is not is ORPHANED, and `task:manage_all` may hand it on
   * (TASK-PLAN §0 C).
   */
  activeMembers(organizationId: string, workspaceId: string, userIds: readonly string[]): Promise<ReadonlySet<string>>;
  describe(userIds: readonly string[]): Promise<readonly TaskMember[]>;
}

/**
 * Telling people about tasks. Speaks the MODULE's language — somebody was
 * assigned, somebody commented — and the app chooses the words, the severity
 * and the source (`module-notification`'s recipe).
 *
 * ⚠ CALLED AFTER THE COMMIT, never inside a transaction, and its failure never
 * fails the write. Recipients never include the person who acted.
 *
 * UNBOUND MEANS NOBODY IS TOLD. Tasks still work.
 */
export interface TaskNotifier {
  assigned(event: TaskNotice): Promise<void>;
  commented(event: TaskNotice & { commentPreview: string }): Promise<void>;
  /**
   * A task is due today, in its workspace's own day — said by the
   * `task.due_today` process, not by a person, so there is no actor.
   */
  dueToday(event: TaskDueNotice): Promise<void>;
}

/** A due-day reminder: a notice with nobody behind it, and the day it is for (`YYYY-MM-DD`). */
export interface TaskDueNotice extends Omit<TaskNotice, 'actorId'> {
  dueOn: string;
}

export interface TaskNotice {
  recipientIds: readonly string[];
  actorId: string;
  organizationId: string;
  workspaceId: string;
  boardId: string;
  boardName: string;
  taskId: string;
  taskTitle: string;
}
