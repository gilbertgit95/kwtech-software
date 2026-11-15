import type { ProcessDeclaration } from '@kwtech/module-kit';
import { FILE_CLEANUP_TIME } from './domain/retention.js';
import { FILE_FEATURE } from './feature-keys.js';

/**
 * The work the file manager does on a SCHEDULE, declared as data
 * (`ProcessDeclaration`, module-kit) and run by `module-jobs`. The code that
 * runs it is `FileCleanupProcess`, joined in `server-module.ts`.
 */
export const FILE_PROCESS = {
  cleanup: 'file.cleanup',
} as const;

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;

export const FILE_PROCESS_REGISTRY: readonly ProcessDeclaration[] = [
  {
    key: FILE_PROCESS.cleanup,
    module: 'file',
    label: 'File clean-up',
    description:
      'Every night at 10 PM, in each workspace’s own time, deletes the uploaded files older than the workspace keeps ' +
      'them (24 hours unless changed), and any stray file left in the folder by an upload that never finished.',
    /*
     * Only where the organization's plan includes files (JOBS-PLAN D12). ⚠ So
     * a workspace whose plan LOSES files is no longer swept, and its files
     * stay in the folder until the plan includes them again; nobody can open
     * them meanwhile (every read is refused `not_entitled`). PLAN §12 records it.
     */
    serves: FILE_FEATURE.read,
    defaultSchedule: { kind: 'daily', times: [FILE_CLEANUP_TIME], weekdays: EVERY_DAY },
    /*
     * Fifteen minutes: each sweep reads every entitled workspace, so it must not
     * run every minute, and a workspace's 10 PM is reached within fifteen
     * minutes of it. Every sweep in the window deletes the same files
     * (`fileCleanupMoment`), so running 10 PM four times deletes nothing twice.
     */
    scheduleLimits: { kinds: ['daily', 'interval'], minEveryMinutes: 15 },
    maxRunSeconds: 300,
    /*
     * Five thousand files: each is a row and a file to remove, quick, and a
     * workspace's files are bounded by its storage cap. Past it the rest wait
     * for the next sweep, fifteen minutes later — they still match.
     */
    maxItemsPerRun: 5000,
    /*
     * Until the workspace's midnight (an occurrence never carries past it): a
     * clean-up is never worse for being late, so a sweep after an outage still
     * deletes what 10 PM would have. Past midnight, the next night's clean-up
     * deletes it instead.
     */
    tooLateAfterMinutes: 120,
  },
];
