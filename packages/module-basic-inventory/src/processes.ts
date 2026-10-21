import type { ProcessDeclaration } from '@kwtech/module-kit';
import { STOCK_FEATURE } from './feature-keys.js';

/**
 * The work the stock app does on a SCHEDULE rather than on a request, declared
 * as data (`ProcessDeclaration`, module-kit). The runner — `module-jobs`, which
 * this module has never heard of — mirrors these to the database and runs them.
 *
 * Here in the pure root, like the feature registry, because the app's seed
 * task reads it without building a Nest module. The code that runs each one is
 * in `src/server/`, joined to its declaration in `server-module.ts`.
 *
 * One process: catching up on point-of-sale lines whose push was lost
 * (INVENTORY-PLAN §5).
 */
export const STOCK_PROCESS = {
  catchUp: 'stock.catch_up',
} as const;

/** How far back before its cursor each run reads again, so an event committed just before the last run is not missed. */
export const STOCK_CATCH_UP_OVERLAP_MS = 10 * 60 * 1000;

export const STOCK_PROCESS_REGISTRY: readonly ProcessDeclaration[] = [
  {
    key: STOCK_PROCESS.catchUp,
    module: 'stock',
    label: 'Stock catch-up from the point of sale',
    description:
      'Reads the point of sale’s recent sales, voids and refunds, and takes off stock any that were not recorded when they happened — ' +
      'for instance because the server restarted at that moment. A sale is never taken twice.',
    // Only where the organization's plan includes stock at all (JOBS-PLAN D12).
    serves: STOCK_FEATURE.read,
    /*
     * Every fifteen minutes: a lost push is rare (the server stopping between
     * the POS's commit and the call), and a count a quarter of an hour late is
     * corrected long before anyone counts the shelf.
     */
    defaultSchedule: { kind: 'interval', everyMinutes: 15 },
    /*
     * `interval` only: a daily time would leave a whole day's lost sales
     * uncounted. Not under five minutes — one run reads every entitled
     * workspace's feed.
     */
    scheduleLimits: { kinds: ['interval'], minEveryMinutes: 5 },
    maxRunSeconds: 120,
    /* Events, across every workspace in one run: the rest wait for the next, which starts where this one stopped. */
    maxItemsPerRun: 2000,
    /*
     * Declared because every process must, but never used to skip: a sale is
     * stock that left the shelf whenever it is noticed, so the run takes it
     * however late. A week, so the admin screen reads sensibly.
     */
    tooLateAfterMinutes: 10_080,
  },
];
