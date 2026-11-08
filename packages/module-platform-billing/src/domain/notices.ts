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
  | 'no_payment_details';

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

/** How many days before the due date the countdown speaks, latest first. */
const COUNTDOWN: ReadonlyArray<{ before: number; kind: ReminderKind }> = [
  { before: 0, kind: 'due_today' },
  { before: 1, kind: 'due_in_1' },
  { before: 3, kind: 'due_in_3' },
  { before: 7, kind: 'due_in_7' },
];

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
 * - Otherwise: the countdown stage today falls in, an overdue notice each
 *   day of grace (the last day is the last warning), and the expiry.
 */
export function planReminders(
  window: AccessWindow | null,
  today: DayKey,
  pending: PendingForReminders | null,
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
    planned.push(
      today === last
        ? { kind: 'last_warning', day: today, daysLeft: left }
        : { kind: 'overdue', day: today, daysLeft: left },
    );
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
