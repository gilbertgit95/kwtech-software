import type { AccessWindow } from './access.js';
import { addDays, type DayKey, daysBetween } from './days.js';

/**
 * WHAT THE DAILY CHECK TELLS AN ORGANIZATION, AND WHEN (PLATFORM-BILLING-PLAN
 * §4 "The daily check", #95). Pure: the process works out the one notice an
 * organization is owed on a day, and a row under `@@unique` makes it once.
 *
 * ⚠ ONE NOTICE PER STAGE, KEYED BY THE STAGE'S OWN DAY. The countdown has
 * milestones (7, 3 and 1 days before the due date, the due date), then a
 * notice each overdue day, a last warning, and the expiry. Each notice's key
 * is the milestone's day, not the day the run happened to be, so a run missed
 * on a milestone catches up ONCE on the next run (still inside the stage),
 * and a second run the same day creates nothing.
 */

/** A reminder about the organization's subscription. */
export type ReminderKind =
  | 'due_in_7'
  | 'due_in_3'
  | 'due_in_1'
  | 'due_today'
  /** Each day of grace or hold, with the days of access left. */
  | 'overdue'
  /** The last day of access. */
  | 'last_warning'
  /** Access has ended: the organization is on the fallback plan. */
  | 'expired'
  /** A request is waiting with no payment details: nothing can be approved until they are entered (loophole 14). */
  | 'no_payment_details'
  /**
   * Auto-renew is on and the credit pays the next renewal (#129): said once,
   * a week before the due date, in place of the countdown that asks to pay.
   */
  | 'auto_renew_upcoming'
  /**
   * Auto-renew is on, the plan was due, and it was not renewed, with why
   * (#129, `AutoRenewSkip`). Written by the daily check itself, once a period.
   */
  | 'auto_renew_skipped';

/** One notice the daily check owes, with the day that keys it. */
export interface PlannedReminder {
  kind: ReminderKind;
  /** The day the notice is FOR: a milestone's day, or today for a daily one. Part of its unique key. */
  day: DayKey;
  /** Days of access left after today (overdue, last warning), or until the due date (the countdown). */
  daysLeft: number;
}

/** What the plan reads about an organization's request waiting for approval. */
export interface PendingForReminders {
  /** Payment details covering the bill were entered: the organization has done its part. */
  covered: boolean;
  /** Any payment details at all. */
  hasDetails: boolean;
}

/** What the plan reads about auto-renew (#129): null when it is off. */
export interface AutoRenewForReminders {
  /** The credit balance pays the whole next renewal, so nobody needs to pay. */
  covered: boolean;
}

/** How many days before the due date the countdown speaks, latest first. The due date itself is said with the overdue days. */
const COUNTDOWN: ReadonlyArray<{ before: number; kind: ReminderKind }> = [
  { before: 1, kind: 'due_in_1' },
  { before: 3, kind: 'due_in_3' },
  { before: 7, kind: 'due_in_7' },
];

/** The countdown's first milestone, in days before the due date: when an automatic renewal is announced. */
const COUNTDOWN_FIRST = 7;

/**
 * The reminders an organization is owed on `today`, given its access window
 * (`null`: no paid subscription, so none) and its pending request.
 *
 * - A pending request with no payment details is reminded every day, before
 *   and after the due date alike: until they are entered nothing can be
 *   approved, and the organization may think paying was enough.
 * - A pending request whose details cover the bill silences the countdown and
 *   the overdue notices: the organization did its part and is waiting on us.
 *   The expiry is still said, since access did end.
 * - Auto-renew on and the credit paying the next renewal (#129): one notice
 *   a week before that it renews by itself, in place of the countdown. On
 *   the due date the daily check renews it before reminding, so the due and
 *   overdue notices are said only when it could not, beside the reason.
 * - Otherwise: the countdown stage today falls in, an overdue notice each
 *   day of grace (the last day is the last warning), and the expiry.
 */
export function planReminders(
  window: AccessWindow | null,
  today: DayKey,
  pending: PendingForReminders | null,
  autoRenew: AutoRenewForReminders | null = null,
): readonly PlannedReminder[] {
  const planned: PlannedReminder[] = [];
  if (pending && !pending.hasDetails) planned.push({ kind: 'no_payment_details', day: today, daysLeft: 0 });
  if (!window) return planned;

  const { periodEnd, accessUntil } = window;
  if (today >= accessUntil) {
    // Keyed by the day access ended: said once, however many runs follow.
    planned.push({ kind: 'expired', day: accessUntil, daysLeft: 0 });
    return planned;
  }
  if (pending?.covered) return planned;

  if (today >= periodEnd) {
    const left = daysBetween(today, accessUntil);
    const last = addDays(accessUntil, -1);
    // The due date is said as such; the last day of access outranks it when grace is a single day.
    const kind: ReminderKind = today === last ? 'last_warning' : today === periodEnd ? 'due_today' : 'overdue';
    planned.push({ kind, day: today, daysLeft: left });
    return planned;
  }

  // ⚠ Nothing to pay (#129): one notice that it renews by itself, never "renew it" days before it does.
  if (autoRenew?.covered) {
    const notice = addDays(periodEnd, -COUNTDOWN_FIRST);
    if (notice <= today)
      planned.push({ kind: 'auto_renew_upcoming', day: notice, daysLeft: daysBetween(today, periodEnd) });
    return planned;
  }

  // The latest milestone that has come: a run missed on it catches up while its stage lasts.
  for (const step of COUNTDOWN) {
    const milestone = addDays(periodEnd, -step.before);
    if (milestone <= today) {
      planned.push({ kind: step.kind, day: milestone, daysLeft: daysBetween(today, periodEnd) });
      break;
    }
  }
  return planned;
}

/** Whether a request has waited long enough to remind approvers about it: more than a day (plan §4). */
export function isWaitingTooLong(requestedAt: Date, now: Date): boolean {
  return now.getTime() - requestedAt.getTime() > 24 * 60 * 60 * 1000;
}
