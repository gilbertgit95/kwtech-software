import type { FeatureContribution, LimitContribution } from '@kwtech/module-kit';

/**
 * What the queue lets somebody do, and how much of it.
 *
 * ⚠ EVERY KEY IS WORKSPACE LEVEL — the first module other than permissions
 * below app level, and so the first that meets §12.13's trap from outside. A
 * GraphQL resolver has no path; with no declared scope the guard resolves app
 * level, where no workspace key participates, and every key below grants
 * nothing to everybody. Step 4 declares a scope on every resolver with
 * `REQUIRED_SCOPE_METADATA` from `@kwtech/module-kit`, and a surface-coverage
 * test fails on any resolver without one.
 *
 * ⚠ WORKSPACE KEYS ARE FILTERED BY THE PLAN. A key no plan entitles is a key
 * nobody can use (§12.61: every tier except `free`).
 *
 * Keys are ATOMIC and split by RISK. Starting publishes the queue to TVs;
 * stopping takes every screen dark and every window out of service mid-shift.
 * Different risks, different keys, and a role may carry both.
 */
export const QUEUE_FEATURE = {
  /** The console, the live board inside the app, and `queueEvents`. */
  read: 'queue:read',
  /**
   * Work the window you are ASSIGNED: Call next, Recall, Done, No-show, Call
   * number…. Only while a session is open.
   */
  serve: 'queue:serve',
  /** Assign a window to a member (yourself included), move someone, free a window. */
  assignWindows: 'queue:assign_windows',
  /** Create, rename and archive windows; manage lines and set a line's next number; clear a nickname. */
  manageWindows: 'queue:manage_windows',
  /** Start queuing, see the display code and QR, and set whether TVs show nicknames. */
  start: 'queue:start',
  /** Stop queuing, which takes every display dark. Seats are kept. */
  stop: 'queue:stop',
} as const;

export type QueueFeatureKey = (typeof QUEUE_FEATURE)[keyof typeof QUEUE_FEATURE];

/*
 * ── no key for releasing your own seat, or for your own nickname ────────────
 *
 * Ending a shift is not a permission, and a nickname is the person's own row.
 * Withholding either would be a lockout dressed as a permission — the
 * `leaveChat` rule.
 *
 * ── no key for issuing a number ─────────────────────────────────────────────
 *
 * Numbers are handed out outside the system (§12.58). `queue:issue` was
 * withdrawn with the reading that invented it.
 */

const op = (identifier: string) => ({ surface: 'graphql_operation', identifier });

/**
 * Contributed to the app's composed registry. The host spreads it into
 * `seed/registry.ts`: one import, one line.
 *
 * ⚠ THE BINDINGS ARE THE GUARD. This module cannot use `@RequireFeature` — the
 * decorator belongs to `module-permissions`, and a module may not import a
 * module (§9) — so `FeatureGuard` enforces each operation through the binding
 * below. A missing binding is an UNGUARDED MUTATION, which is why
 * `surface-coverage.test.ts` fails on any operation that is neither bound nor
 * named there as deliberately unbound.
 */
export const QUEUE_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: QUEUE_FEATURE.read,
    module: 'queue',
    level: 'workspace',
    label: 'See the queue',
    description: 'Open the queue console and watch every window live.',
    tags: ['queue'],
    bindings: [
      op('Query.queueConsole'),
      /*
       * ⚠ A person's OWN nickname, and still bound. An unbound operation skips
       * the guard's workspace-membership check entirely, and this one WRITES a
       * row into the workspace named in the request. The key is what makes
       * "a member of this workspace" true before the row is written.
       */
      op('Mutation.setMyQueueNickname'),
    ],
  },
  {
    key: QUEUE_FEATURE.serve,
    module: 'queue',
    level: 'workspace',
    label: 'Serve at a window',
    description: 'Call, recall and complete numbers at the window you are assigned, while queuing is running.',
    tags: ['queue'],
    bindings: [
      op('Mutation.callNextQueueTicket'),
      op('Mutation.callQueueNumber'),
      op('Mutation.recallQueueTicket'),
      op('Mutation.completeQueueTicket'),
      op('Mutation.markQueueTicketNoShow'),
    ],
  },
  {
    key: QUEUE_FEATURE.assignWindows,
    module: 'queue',
    level: 'workspace',
    label: 'Assign windows',
    description: 'Assign a window to a member, including yourself, move someone to another window, or free a window.',
    tags: ['queue'],
    bindings: [op('Query.queueStaffCandidates'), op('Mutation.assignQueueWindow'), op('Mutation.freeQueueWindow')],
  },
  {
    key: QUEUE_FEATURE.manageWindows,
    module: 'queue',
    level: 'workspace',
    label: 'Manage windows and lines',
    description: "Create, rename and archive windows and lines, set a line's next number, and clear a staff nickname.",
    tags: ['queue'],
    bindings: [
      op('Mutation.createQueueWindow'),
      op('Mutation.updateQueueWindow'),
      op('Mutation.setQueueWindowLines'),
      op('Mutation.setQueueWindowArchived'),
      op('Mutation.createQueueLine'),
      op('Mutation.updateQueueLine'),
      op('Mutation.setQueueLineArchived'),
      op('Mutation.setQueueLineNextNumber'),
      // Clearing somebody else's nickname. Never setting one.
      op('Mutation.clearQueueNickname'),
    ],
  },
  {
    key: QUEUE_FEATURE.start,
    module: 'queue',
    /*
     * ⚠ A DISCLOSURE ACT. Starting generates the code that admits a screen in a
     * public room, and whoever holds this sees that code and decides whether
     * staff nicknames reach those screens.
     */
    isPrivileged: true,
    level: 'workspace',
    label: 'Start queuing',
    description:
      'Start a queuing session, which generates the code that admits public displays, and choose whether displays show staff nicknames.',
    tags: ['queue'],
    bindings: [
      op('Mutation.startQueue'),
      // The people who can authorise a display are the people who can see what authorises it.
      op('Query.queueDisplayCode'),
      op('Mutation.setQueueShowStaffNames'),
    ],
  },
  {
    key: QUEUE_FEATURE.stop,
    module: 'queue',
    level: 'workspace',
    label: 'Stop queuing',
    description: 'Stop the queuing session. Every public display goes dark; window assignments are kept.',
    tags: ['queue'],
    bindings: [op('Mutation.stopQueue')],
  },
];

export const QUEUE_LIMIT = {
  /** How many live windows a workspace may have. */
  windows: 'queue:windows',
  /** How many displays may hold a pass in one queuing session. */
  displays: 'queue:displays',
} as const;

/**
 * The caps, PLAN-SOURCED: every `queue:*` key is workspace level, so an
 * organization's subscription is there to read. The same numbers in every tier
 * for now; tiering them later is a product decision with no schema cost.
 *
 * ⚠ `queue:displays` is RESOLVED AT START and stored on the session as
 * `maxDisplays`. The code exchange has no actor, and a limit checker reads an
 * actor's limits.
 */
export const QUEUE_LIMIT_REGISTRY: readonly LimitContribution[] = [
  {
    key: QUEUE_LIMIT.windows,
    module: 'queue',
    label: 'Queue windows',
    description: 'How many windows, not counting archived ones, a workspace may have.',
    source: 'plan',
    countedOver: 'workspace',
    required: false,
    defaultValue: 10,
  },
  {
    key: QUEUE_LIMIT.displays,
    module: 'queue',
    label: 'Queue displays',
    description:
      'How many screens may show the queue during one queuing session. A phone that scans the code counts as one.',
    source: 'plan',
    countedOver: 'workspace',
    required: false,
    defaultValue: 5,
  },
];

/**
 * A workspace role a host MAY create, exported as data and never seeded by this
 * module. Adopting the queue grants nobody anything until somebody says who may
 * use it.
 */
export interface QueueRolePreset {
  key: string;
  label: string;
  icon: string;
  level: 'workspace';
  features: readonly QueueFeatureKey[];
}

export const QUEUE_ROLE_PRESETS: readonly QueueRolePreset[] = [
  {
    key: 'queue-staff',
    label: 'Queue staff',
    icon: 'monitor',
    level: 'workspace',
    features: [QUEUE_FEATURE.read, QUEUE_FEATURE.serve],
  },
  {
    key: 'queue-supervisor',
    label: 'Queue supervisor',
    icon: 'users',
    level: 'workspace',
    features: [
      QUEUE_FEATURE.read,
      QUEUE_FEATURE.serve,
      QUEUE_FEATURE.assignWindows,
      QUEUE_FEATURE.start,
      QUEUE_FEATURE.stop,
    ],
  },
  {
    key: 'queue-admin',
    label: 'Queue admin',
    icon: 'settings',
    level: 'workspace',
    features: Object.values(QUEUE_FEATURE),
  },
];
