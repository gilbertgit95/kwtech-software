import type { FeatureContribution, LimitContribution } from '@kwtech/module-kit';

/**
 * What the tasks app lets somebody do, and how much of it (docs/TASK-PLAN.md §3).
 *
 * ⚠ WORKSPACE LEVEL, like every sub-app's: an app always lives under a
 * workspace, and the Apps page asks the key of the workspace in the URL. A
 * workspace key is also FILTERED BY THE PLAN, so a key no plan entitles is a
 * key nobody can use.
 *
 * ⚠ A KEY SAYS WHAT, A BOARD SAYS WHERE. The keys decide what a person may do in
 * this workspace; the board's kind decides which boards they may do it on — a
 * shared board is open to everyone holding `task:read`, a private one to its
 * owner alone. Both must agree, and no key opens somebody else's private board.
 *
 * Keys are ATOMIC and split by RISK: reading; working with tasks; owning boards;
 * pointing work at OTHER people; and throwing away other people's work.
 */
export const TASK_FEATURE = {
  /** Open the app; read the boards you can open, their tasks and comments; My tasks; your own settings. */
  read: 'task:read',
  /**
   * On boards you can open: create, edit, move and archive tasks; checklists,
   * labels, dates, priority; comment; assign yourself.
   */
  write: 'task:write',
  /** Create boards and own them: columns, private or shared, rename, archive, delete. */
  createBoards: 'task:create_boards',
  /** Assign OTHER people. Anyone who may write may assign themselves. */
  assign: 'task:assign',
  /**
   * Delete other people's tasks and comments on boards you can open, and take
   * over a board whose owner has left. Never opens a private board.
   */
  manageAll: 'task:manage_all',
} as const;

export type TaskFeatureKey = (typeof TASK_FEATURE)[keyof typeof TASK_FEATURE];

/*
 * ── no key that opens somebody else's private board ─────────────────────────
 *
 * Not `manage_all`, not a super admin's. "Private" is a promise made to the
 * owner, and a key that breaks it would make every private board shared with
 * whoever an organization later hands that key to (TASK-PLAN §0 C). Taking over
 * an orphaned board shows its NAME and SIZE only.
 *
 * ── no key for managing labels ──────────────────────────────────────────────
 *
 * A label is text on one task, not a row in a shared vocabulary: a vocabulary
 * would list the labels on private boards to everybody (TASK-PLAN decision 15).
 */

const op = (identifier: string) => ({ surface: 'graphql_operation', identifier });

/**
 * Contributed to the app's composed registry (`seed/registry.ts`).
 *
 * ⚠ THE BINDINGS ARE THE GUARD. This module cannot use `@RequireFeature` — the
 * decorator belongs to `module-permissions`, and a module may not import a
 * module (§9) — so `FeatureGuard` enforces each operation through its binding.
 * A missing binding is an UNGUARDED OPERATION, which is why
 * `surface-coverage.test.ts` fails on any operation that is not bound here.
 */
export const TASK_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: TASK_FEATURE.read,
    module: 'task',
    level: 'workspace',
    label: 'See tasks',
    description: 'Open the tasks app, and read the boards shared with the workspace and your own private ones.',
    tags: ['task'],
    bindings: [
      op('Query.taskBoards'),
      op('Query.taskBoard'),
      op('Query.tasks'),
      op('Query.task'),
      op('Query.myTasks'),
      op('Query.taskComments'),
      op('Query.myTaskSettings'),
      /*
       * ⚠ The person's OWN settings, and still bound. An unbound operation skips
       * the guard's workspace-membership check entirely, and this WRITES a row
       * into the workspace named in the request. The key is what makes "a
       * member of this workspace" true before the row is written.
       */
      op('Mutation.setMyTaskSettings'),
      /*
       * ⚠ ITS OWN SURFACE. A subscription is authorised ONCE, here, and then
       * streams — filtered per subscriber, so a private board's changes reach
       * its owner alone.
       */
      { surface: 'graphql_subscription', identifier: 'Subscription.taskEvents' },
    ],
  },
  {
    key: TASK_FEATURE.write,
    module: 'task',
    level: 'workspace',
    label: 'Work with tasks',
    description:
      'Create, edit, move and archive tasks on the boards you can open, comment on them, and assign yourself.',
    tags: ['task'],
    bindings: [
      op('Mutation.createTask'),
      op('Mutation.updateTask'),
      op('Mutation.moveTask'),
      op('Mutation.setTaskDates'),
      op('Mutation.setTaskPriority'),
      op('Mutation.setTaskLabels'),
      /*
       * One operation whoever is assigned: `task:write` lets you assign
       * yourself, and the service asks `TaskAccessCheck` for `task:assign` only
       * when somebody ELSE is newly added.
       */
      op('Mutation.setTaskAssignees'),
      op('Mutation.addTaskChecklistItem'),
      op('Mutation.updateTaskChecklistItem'),
      op('Mutation.moveTaskChecklistItem'),
      op('Mutation.removeTaskChecklistItem'),
      op('Mutation.addTaskComment'),
      op('Mutation.updateTaskComment'),
      /*
       * Archiving, restoring, deleting forever and removing a comment are ONE
       * operation each, whoever does it; the service asks for
       * `task:manage_all` only when the task or comment is somebody else's.
       */
      op('Mutation.removeTaskComment'),
      op('Mutation.archiveTask'),
      op('Mutation.restoreTask'),
      op('Mutation.deleteTaskForever'),
    ],
  },
  {
    key: TASK_FEATURE.createBoards,
    module: 'task',
    level: 'workspace',
    label: 'Create task boards',
    description:
      'Create boards and configure the ones you own: their columns, whether they are private or shared, archiving and deleting.',
    tags: ['task'],
    /*
     * ⚠ EVERY ONE OF THESE ALSO CHECKS OWNERSHIP in the service. The key says
     * "may own boards here"; it does not make you the owner of this one.
     */
    bindings: [
      op('Mutation.createTaskBoard'),
      op('Mutation.updateTaskBoard'),
      op('Mutation.setTaskBoardVisibility'),
      op('Mutation.addTaskColumn'),
      op('Mutation.updateTaskColumn'),
      op('Mutation.moveTaskColumn'),
      op('Mutation.removeTaskColumn'),
      op('Mutation.archiveTaskBoard'),
      op('Mutation.restoreTaskBoard'),
      op('Mutation.deleteTaskBoardForever'),
    ],
  },
  {
    key: TASK_FEATURE.assign,
    module: 'task',
    level: 'workspace',
    label: 'Assign tasks to others',
    description: 'Assign other members of the workspace to tasks on shared boards.',
    tags: ['task'],
    /*
     * The list of people to pick from is bound here: somebody who may only
     * assign themselves has no reason to read the workspace's member list.
     * Assigning itself is `setTaskAssignees`, bound to `task:write`, which asks
     * the `TaskAccessCheck` port for this key.
     */
    bindings: [op('Query.taskAssignableMembers')],
  },
  {
    key: TASK_FEATURE.manageAll,
    module: 'task',
    /*
     * ⚠ PRIVILEGED because it throws away work that is not the holder's, and
     * hands a board to somebody else. It never opens a private board.
     */
    isPrivileged: true,
    level: 'workspace',
    label: 'Manage everyone’s tasks',
    description:
      'Delete other people’s tasks and comments on shared boards, and take over a board whose owner has left the workspace.',
    tags: ['task'],
    bindings: [op('Query.orphanedTaskBoards'), op('Mutation.transferTaskBoard')],
  },
];

export const TASK_LIMIT = {
  /** How many boards one person may own in a workspace, archived ones included. */
  boards: 'task:boards',
  /** How many tasks one person may have created in a workspace, archived ones included. */
  tasks: 'task:tasks',
} as const;

/**
 * The caps, PLAN-SOURCED — every `task:*` key is workspace level, so an
 * organization's subscription is there to read — and COUNTED PER PERSON.
 *
 * ⚠ PER PERSON, NOT PER WORKSPACE. Nobody may open another member's private
 * board, so nobody could clear it: a workspace-wide cap would let one person,
 * or one departed person, fill everybody's quota with work no admin can see.
 *
 * ⚠ ARCHIVED ONES COUNT. Otherwise archive-then-create is unlimited storage.
 * Deleting forever is what frees a place.
 *
 * The module counts, in the transaction that inserts; the host's `LimitChecker`
 * only resolves the number (`LimitCheckInput.current`).
 */
export const TASK_LIMIT_REGISTRY: readonly LimitContribution[] = [
  {
    key: TASK_LIMIT.boards,
    module: 'task',
    label: 'Task boards per person',
    description: 'How many boards one person may own in a workspace, counting archived ones.',
    source: 'plan',
    countedOver: 'user',
    required: false,
    defaultValue: 20,
  },
  {
    key: TASK_LIMIT.tasks,
    module: 'task',
    label: 'Tasks per person',
    description: 'How many tasks one person may have created in a workspace, counting archived ones.',
    source: 'plan',
    countedOver: 'user',
    required: false,
    defaultValue: 2000,
  },
];

/**
 * A workspace role a host MAY create, exported as data and never seeded by this
 * module. The app's `seed/app-roles.ts` reads it.
 */
export interface TaskRolePreset {
  key: string;
  label: string;
  icon: string;
  level: 'workspace';
  features: readonly TaskFeatureKey[];
}

export const TASK_ROLE_PRESETS: readonly TaskRolePreset[] = [
  {
    key: 'task-user',
    label: 'Tasks user',
    icon: 'checklist',
    level: 'workspace',
    features: [TASK_FEATURE.read, TASK_FEATURE.write, TASK_FEATURE.createBoards, TASK_FEATURE.assign],
  },
  {
    key: 'task-admin',
    label: 'Tasks admin',
    icon: 'checklist',
    level: 'workspace',
    features: [
      TASK_FEATURE.read,
      TASK_FEATURE.write,
      TASK_FEATURE.createBoards,
      TASK_FEATURE.assign,
      TASK_FEATURE.manageAll,
    ],
  },
];
