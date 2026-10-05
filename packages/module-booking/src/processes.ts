import type { ProcessDeclaration } from '@kwtech/module-kit';
import { BOOKING_FEATURE } from './feature-keys.js';

/**
 * The work booking does on a SCHEDULE rather than on a request, declared as
 * data (`ProcessDeclaration`, module-kit). The runner — `module-jobs`, which
 * this module has never heard of — mirrors these to the database and runs them.
 *
 * Here in the pure root, like the feature registry, because the app's seed
 * task reads it without building a Nest module. The code that runs each one is
 * in `src/server/`, joined to its declaration in `server-module.ts`.
 *
 * Two processes: reminding staff of a booking about to start, and letting a
 * request nobody confirmed LAPSE (BOOKING-PLAN §8).
 */
export const BOOKING_PROCESS = {
  upcomingSessions: 'booking.upcoming_sessions',
  lapseRequests: 'booking.lapse_requests',
} as const;

export const BOOKING_PROCESS_REGISTRY: readonly ProcessDeclaration[] = [
  {
    key: BOOKING_PROCESS.upcomingSessions,
    module: 'booking',
    label: 'Upcoming booking reminders',
    description:
      'Shortly before a confirmed booking starts, tells the member of staff it is with — or everybody at the desk, when it is with a place, a machine or somebody without an account. ' +
      'How long before is each workspace’s own setting, and a workspace can turn it off.',
    // Only where the organization's plan includes booking at all (JOBS-PLAN D12).
    serves: BOOKING_FEATURE.read,
    /*
     * Every five minutes, everywhere at once: a booking's start is an instant,
     * not a time of day, so there is no "each workspace's 8:00" to wait for.
     * Five, so a notice set for fifteen minutes before arrives between ten and
     * fifteen before.
     */
    defaultSchedule: { kind: 'interval', everyMinutes: 5 },
    /*
     * `interval` only: a daily time would remind of the day's first bookings
     * and no others. Not under five minutes — one run reads every entitled
     * workspace — and an admin may slow it, at the price of later notices.
     */
    scheduleLimits: { kinds: ['interval'], minEveryMinutes: 5 },
    maxRunSeconds: 60,
    maxItemsPerRun: 500,
    /*
     * ⚠ FOR THIS PROCESS, TOO LATE IS "ALREADY STARTED". A reminder that a
     * booking is about to start is worth nothing once it has. So this number is
     * not a grace period: it is how far BACK a run looks for bookings that
     * started unreminded (after a pause or an outage), so that each is counted
     * as skipped, once, instead of going unnoticed. An hour, so the query stays
     * small after a long outage.
     */
    tooLateAfterMinutes: 60,
  },
  {
    key: BOOKING_PROCESS.lapseRequests,
    module: 'booking',
    label: 'Lapse unanswered booking requests',
    description:
      'Declines a request made on the public booking page that nobody confirmed in time — after the hours each workspace sets, or when its own time arrives — so the time it was holding becomes free again. ' +
      'Paused, requests keep their times until staff answer them.',
    serves: BOOKING_FEATURE.read,
    /*
     * Every five minutes: a request is held until it lapses, so the wait past
     * its time is how long a free slot is wrongly shown as taken.
     */
    defaultSchedule: { kind: 'interval', everyMinutes: 5 },
    // `interval` only — there is no time of day at which requests go stale.
    scheduleLimits: { kinds: ['interval'], minEveryMinutes: 5 },
    maxRunSeconds: 60,
    maxItemsPerRun: 500,
    /*
     * ⚠ REQUIRED BY THE CONTRACT, AND NEVER USED: nothing is too late to lapse.
     * A request found a day past its time is still lapsed, because skipping it
     * would hold its slot for ever. A day, so the number says "no real limit"
     * rather than suggesting a window.
     */
    tooLateAfterMinutes: 1440,
  },
];
