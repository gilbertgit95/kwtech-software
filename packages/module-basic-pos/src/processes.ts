import type { ProcessDeclaration } from '@kwtech/module-kit';
import { POS_FEATURE } from './feature-keys.js';

/**
 * The work the point of sale does on a SCHEDULE rather than on a request,
 * declared as data (`ProcessDeclaration`, module-kit). The runner —
 * `module-jobs`, which this module has never heard of — mirrors these to the
 * database and runs them.
 *
 * Here in the pure root, like the feature registry, because the app's seed
 * task reads it without building a Nest module. The code that runs each one is
 * in `src/server/`, joined to its declaration in `server-module.ts`.
 *
 * One process: ranking each store's items and variants by how many orders
 * included them in the last 7 days, for the sell views (issue #47).
 */
export const POS_PROCESS = {
  rankItems: 'pos.rank_items',
} as const;

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;

export const POS_PROCESS_REGISTRY: readonly ProcessDeclaration[] = [
  {
    key: POS_PROCESS.rankItems,
    module: 'pos',
    label: 'Most-ordered items',
    description:
      'Once a day, counts how many orders included each item and size in the last 7 days, so the till lists ' +
      'what sells most at the top. Paused, the tills keep the last ranking it made.',
    // Every store whose plan includes the point of sale: every till sorts by it (JOBS-PLAN D12).
    serves: POS_FEATURE.read,
    /*
     * 03:00 in each store's own time, every day: after the evening's last
     * order and before the morning's first, so a till opened in the morning
     * already has yesterday counted.
     */
    defaultSchedule: { kind: 'daily', times: ['03:00'], weekdays: EVERY_DAY },
    /*
     * `daily` only: a ranking does not change within a day — its window is
     * whole days — so running it more often would recount the same days.
     * Swept every 15 minutes, so a store's 03:00 is noticed by 03:15.
     */
    scheduleLimits: { kinds: ['daily'], minEveryMinutes: 15 },
    /* One store is a read of a week's orders and two small writes; a run of 200 stores fits in five minutes. */
    maxRunSeconds: 300,
    /* Stores per run. The rest are found by the next sweep, still not ranked for today. */
    maxItemsPerRun: 200,
    /*
     * Twenty hours: after an outage, ranking at 22:00 is still better than
     * keeping the day before's — the window is whole past days, and today
     * never counts. Past that the store is skipped, counted, and ranked
     * tomorrow.
     */
    tooLateAfterMinutes: 1200,
  },
];
