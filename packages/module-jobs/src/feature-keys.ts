import type { FeatureContribution } from '@kwtech/module-kit';

/**
 * What the background runner lets somebody do (JOBS-PLAN §6).
 *
 * ⚠ EVERY KEY IS APP LEVEL. A process is one thing for the whole application,
 * paused and scheduled once (D3, D7), so there is no tenant to ask the question
 * inside: the resolver declares no scope, and no organization's plan includes
 * these — app-level grants bypass the plan filter.
 *
 * Keys are ATOMIC and split by RISK, so seeing does not grant control, and
 * pausing, forcing and rescheduling are each granted apart. Pausing stops
 * reminders for every organization at once; forcing a run only does early what
 * would have happened anyway. Different risks, different keys.
 */
export const JOBS_FEATURE = {
  /** The admin page: every process, how it stands, and its history. */
  read: 'jobs:read',
  /** Pause a process, with a reason, and resume it. */
  pause: 'jobs:pause',
  /** Force a run now. */
  run: 'jobs:run',
  /** Change how often or when a process runs, and reset it to its default. */
  schedule: 'jobs:schedule',
} as const;

export type JobsFeatureKey = (typeof JOBS_FEATURE)[keyof typeof JOBS_FEATURE];

const op = (identifier: string) => ({ surface: 'graphql_operation', identifier });

/**
 * Contributed to the app's composed registry. The host adds it to
 * `seed/registry.ts`: one import, one line.
 *
 * ⚠ THE BINDINGS ARE THE GUARD. This module cannot use `@RequireFeature` — the
 * decorator belongs to `module-permissions`, and a module may not import a
 * module (PLAN §9) — so `FeatureGuard` enforces each operation through the
 * binding below. A missing binding is an UNGUARDED MUTATION that pauses every
 * organization's reminders, which is why `surface-coverage.test.ts` fails on
 * any operation that is not bound.
 *
 * No role preset is exported: `super-admin` holds every app-level key by
 * derivation, and nobody else has been decided (JOBS-PLAN §6).
 */
export const JOBS_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: JOBS_FEATURE.read,
    module: 'jobs',
    level: 'app',
    label: 'See background processes',
    description: 'See every background process, how it stands, and the history of its runs and control actions.',
    tags: ['jobs'],
    bindings: [op('Query.jobProcesses'), op('Query.jobProcessHistory')],
  },
  {
    key: JOBS_FEATURE.pause,
    module: 'jobs',
    /*
     * PRIVILEGED: a pause stops a process for EVERY organization at once (D3),
     * and what it stops — reminders, lapsing requests — is missed silently.
     */
    isPrivileged: true,
    level: 'app',
    label: 'Pause background processes',
    description: 'Pause a background process for every organization, with a reason, and resume it.',
    tags: ['jobs'],
    bindings: [op('Mutation.pauseJobProcess'), op('Mutation.resumeJobProcess')],
  },
  {
    key: JOBS_FEATURE.run,
    module: 'jobs',
    level: 'app',
    label: 'Run background processes now',
    description: 'Queue a run of a background process now, without waiting for its schedule.',
    tags: ['jobs'],
    bindings: [op('Mutation.runJobProcessNow')],
  },
  {
    key: JOBS_FEATURE.schedule,
    module: 'jobs',
    // PRIVILEGED for the reason pausing is: one change, every organization.
    isPrivileged: true,
    level: 'app',
    label: 'Schedule background processes',
    description: 'Change how often or when a background process runs, within its limits, and reset it to its default.',
    tags: ['jobs'],
    bindings: [op('Mutation.setJobProcessSchedule'), op('Mutation.resetJobProcessSchedule')],
  },
];
