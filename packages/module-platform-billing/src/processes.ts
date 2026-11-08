import type { ProcessDeclaration } from '@kwtech/module-kit';

/**
 * BILLING'S BACKGROUND WORK (PLATFORM-BILLING-PLAN §4 "The daily check", #95),
 * run by `module-jobs`. A module never starts a timer: it declares a process
 * here, and the app joins it to its handler.
 */
export const PLATFORM_BILLING_PROCESS = {
  dailyCheck: 'platform_billing.daily_check',
} as const;

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6] as const;

export const PLATFORM_BILLING_PROCESS_REGISTRY: readonly ProcessDeclaration[] = [
  {
    key: PLATFORM_BILLING_PROCESS.dailyCheck,
    // ⚠ Snake case, as process keys are (`<module>.<what>`, checked at composition): the module key's hyphen is not allowed there.
    module: 'platform_billing',
    label: 'Billing reminders',
    description:
      'Every day, in the billing time zone, reminds each organization’s owner and admins before and after its due date ' +
      'and when access ends, reminds them while a request waits without payment details, and tells billing approvers ' +
      'about requests waiting more than a day. Access itself ends on its own, without this.',
    // ⚠ No plan gate (#94): an expired organization is exactly the one that must be told.
    serves: null,
    reach: 'organizations',
    // The start of a working day in the billing zone, every day: a due date on a Sunday is still due.
    defaultSchedule: { kind: 'daily', times: ['08:00'], weekdays: EVERY_DAY },
    /*
     * An hour at the least: a run reads every organization, and nothing it says
     * changes more than once a day. Its notices are keyed by day, so running
     * more often than that only repeats the reads.
     */
    scheduleLimits: { kinds: ['daily', 'interval'], minEveryMinutes: 60 },
    maxRunSeconds: 300,
    /*
     * Organizations per run. Past it the rest wait for the next run, which
     * finds them still owed their notice: nothing is skipped, only delayed.
     */
    maxItemsPerRun: 2000,
    /*
     * Twelve hours: after an outage, a reminder meant for 8:00 is still worth
     * sending until the evening. Past that it is skipped and counted. The next
     * day's run says the next thing, and a milestone missed altogether is still
     * caught up once while its stage lasts.
     */
    tooLateAfterMinutes: 720,
  },
];
