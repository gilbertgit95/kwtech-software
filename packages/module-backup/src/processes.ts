import type { ProcessDeclaration } from '@kwtech/module-kit';

/**
 * The daily backup (the operator, 2026-10-26: "auto run every day at 9pm"),
 * declared as data for `module-jobs`, as every module's processes are.
 *
 * ⚠ THE RUNNER RECORDS THAT IT RAN — a count, in its own table — and never
 * which file it made: the result carries counts only (module-kit), so no
 * backup's name reaches the database. Whether today's backup exists is read
 * from the folder (`hasDailyBackupFor`), which is what makes a second run on
 * the same day do nothing.
 */
export const BACKUP_PROCESS = {
  daily: 'backup.daily',
} as const;

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;

export const BACKUP_PROCESS_REGISTRY: readonly ProcessDeclaration[] = [
  {
    key: BACKUP_PROCESS.daily,
    module: 'backup',
    label: 'Daily database backup',
    description:
      'Every evening, makes a full copy of the database into the backup folder, then deletes the oldest backups past the ' +
      'number kept. Measured in the backup time zone, not any workspace’s.',
    // The whole database, not any one organization's: it serves no workspace (JOBS-PLAN D12).
    serves: null,
    // 21:00 in the backup zone: after a shop's day, before anybody's night-time maintenance.
    defaultSchedule: { kind: 'daily', times: ['21:00'], weekdays: EVERY_DAY },
    /*
     * Daily only: "every 15 minutes" would fill the folder in a day and push
     * every real backup out of it. Swept every 15 minutes, so 21:00 is noticed
     * by 21:15 — as exact as a nightly copy needs to be.
     */
    scheduleLimits: { kinds: ['daily'], minEveryMinutes: 15 },
    /*
     * Five minutes, the runner's ceiling (JOBS-PLAN D11): this database dumps
     * in about a second, and a hung pg_dump must still end. A database that
     * outgrows it raises `maxRunSecondsCeiling` in the app on purpose.
     */
    maxRunSeconds: 300,
    // One backup a run, whatever happens.
    maxItemsPerRun: 1,
    /*
     * Three hours: after an outage, the evening's backup is still worth making
     * until midnight. The day ends the occurrence anyway (processOccurrence).
     */
    tooLateAfterMinutes: 180,
  },
];
