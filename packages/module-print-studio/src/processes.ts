import type { ProcessDeclaration } from '@kwtech/module-kit';
import { STUDIO_FEATURE } from './feature-keys.js';

/**
 * The work the studio does on a SCHEDULE rather than on a request, declared as
 * data (`ProcessDeclaration`, module-kit). The runner — `module-jobs`, which
 * this module has never heard of — mirrors these to the database and runs them.
 *
 * Here in the pure root, like the feature registry, because the app's seed
 * task reads it without building a Nest module. The code that runs each one is
 * in `src/server/`, joined to its declaration in `server-module.ts`.
 */
export const STUDIO_PROCESS = {
  pruneLogs: 'studio.prune_logs',
} as const;

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;

export const STUDIO_PROCESS_REGISTRY: readonly ProcessDeclaration[] = [
  {
    key: STUDIO_PROCESS.pruneLogs,
    module: 'studio',
    label: 'Clear old print history',
    description:
      'Deletes print history entries older than the time the app keeps them (90 days unless set otherwise). The entries name the files that were printed, which are often customers’ names. ' +
      'Paused, old entries stay until it runs again.',
    // Only where the organization's plan includes the studio at all (JOBS-PLAN D12).
    serves: STUDIO_FEATURE.read,
    // In the small hours of each workspace's own night, when nobody is reading the history.
    defaultSchedule: { kind: 'daily', times: ['03:00'], weekdays: EVERY_DAY },
    /*
     * An hour: one run reads every entitled workspace and deletes in each, and
     * a keep measured in days gains nothing from being enforced by the minute.
     */
    scheduleLimits: { kinds: ['daily', 'interval'], minEveryMinutes: 60 },
    maxRunSeconds: 120,
    /*
     * ⚠ COUNTED IN WORKSPACES PRUNED, not rows: each workspace is one delete of
     * everything past the cutoff, which Postgres does as one statement however
     * many rows it is. Two thousand workspaces with something to delete a run;
     * the rest are reached by the next, because the ones done have nothing left.
     */
    maxItemsPerRun: 2000,
    /*
     * ⚠ REQUIRED BY THE CONTRACT, AND NEVER USED: nothing is too late to
     * prune. A row found a week past its keep is still deleted, because
     * skipping it would keep a customer's name for ever. A day, so the number
     * says "no real limit" rather than suggesting a window.
     */
    tooLateAfterMinutes: 1440,
  },
];
