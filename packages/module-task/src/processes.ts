import type { ProcessDeclaration } from '@kwtech/module-kit';
import { TASK_FEATURE } from './feature-keys.js';

/**
 * The work tasks do on a SCHEDULE rather than on a request, declared as data
 * (`ProcessDeclaration`, module-kit). The runner — `module-jobs`, which this
 * module has never heard of — mirrors these to the database and runs them.
 *
 * Here in the pure root, like the feature registry, because the app's seed
 * task reads it without building a Nest module. The code that runs each one is
 * in `src/server/`, joined to its declaration in `server-module.ts`.
 */
export const TASK_PROCESS = {
  dueToday: 'task.due_today',
} as const;

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;

export const TASK_PROCESS_REGISTRY: readonly ProcessDeclaration[] = [
  {
    key: TASK_PROCESS.dueToday,
    module: 'task',
    label: 'Task due reminders',
    description:
      'On the day a task is due, tells the people assigned to it — or whoever created it, when nobody is assigned. ' +
      'Each workspace is reminded at its own time of day.',
    // Only where the organization's plan includes tasks at all (JOBS-PLAN D12).
    serves: TASK_FEATURE.read,
    // The start of a working day, every day: a task due on a Sunday is still due.
    defaultSchedule: { kind: 'daily', times: ['08:00'], weekdays: EVERY_DAY },
    /*
     * Fifteen minutes: one run reads every entitled workspace, so it must not
     * be set to run every minute — and, on a `daily` schedule, a workspace's
     * 8:00 is noticed within fifteen minutes of it, which is as exact as a
     * "due today" notice needs to be.
     */
    scheduleLimits: { kinds: ['daily', 'interval'], minEveryMinutes: 15 },
    maxRunSeconds: 120,
    maxItemsPerRun: 500,
    /*
     * Ten hours: after an outage, a reminder set for 8:00 is still worth
     * sending until 18:00 — the day's work is not over. Past that it is skipped
     * and counted, rather than arriving as the day ends.
     */
    tooLateAfterMinutes: 600,
  },
];
