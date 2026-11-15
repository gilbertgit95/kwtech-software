import { nextDayKey, zonedDayKey, zonedStartOfDay } from '@kwtech/module-kit';

/**
 * How long a file is kept, and when it goes (issue #138).
 *
 * ⚠ ONE MOMENT DELETES: the nightly clean-up, at 10 PM in the workspace's
 * time zone. It deletes every file uploaded MORE than `retentionHours` before
 * that clean-up's time. Until then a file stays listed and downloadable, even
 * past its age: a file uploaded at 9 PM on Monday is an hour old at Monday's
 * clean-up and kept, and is deleted at 10 PM on Tuesday.
 *
 * The rejected alternative — each file vanishing exactly `retentionHours`
 * after upload — was the operator's to choose, and they chose one nightly
 * moment (#138, 2026-11-15): people know when files go.
 */

/** Kept until a workspace chooses otherwise. */
export const FILE_RETENTION_HOURS_DEFAULT = 24;
/** At least an hour: less, and a file could be deleted before anybody had the chance to download it. */
export const FILE_RETENTION_HOURS_MIN = 1;
/** At most a week. These are TEMPORARY files; keeping them longer is the blob server's job, not this one's. */
export const FILE_RETENTION_HOURS_MAX = 168;

/** The clean-up's time of day, `HH:MM`, in the workspace's zone — the process's declared default. */
export const FILE_CLEANUP_TIME = '22:00';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export function isValidRetentionHours(hours: number): boolean {
  return Number.isInteger(hours) && hours >= FILE_RETENTION_HOURS_MIN && hours <= FILE_RETENTION_HOURS_MAX;
}

/** `HH:MM` as minutes after midnight, or null when it is not a time. */
export function fileMinuteOfDay(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * The instant `time` falls on `dayKey` in `timeZone`. ⚠ Counted from the
 * zone's midnight, so on a daylight-saving day it is an hour off; the
 * workspaces this serves (Asia/Manila by default) have none.
 */
export function zonedTimeOn(dayKey: string, time: string, timeZone: string): Date | null {
  const start = zonedStartOfDay(dayKey, timeZone);
  const minute = fileMinuteOfDay(time);
  if (!start || minute === null) return null;
  return new Date(start.getTime() + minute * MINUTE_MS);
}

/**
 * The newest upload instant a clean-up at `cleanupAt` keeps: every file
 * created BEFORE the cutoff is deleted (strictly — a file exactly
 * `retentionHours` old is not yet "more than").
 */
export function fileCleanupCutoff(cleanupAt: Date, retentionHours: number): Date {
  return new Date(cleanupAt.getTime() - retentionHours * HOUR_MS);
}

/**
 * When the nightly clean-up will delete a file uploaded at `uploadedAt`: the
 * first clean-up time after it is more than `retentionHours` old. For the
 * page's "Deleted at 10 PM on Tue 17 Nov".
 *
 * ⚠ THE DECLARED TIME, not the schedule in force. An admin may move or pause
 * the clean-up on the Background jobs page, and the page cannot read that;
 * PLAN §12 records the gap.
 */
export function fileDeletionAt(
  uploadedAt: Date,
  retentionHours: number,
  timeZone: string,
  time: string = FILE_CLEANUP_TIME,
): Date | null {
  const oldEnough = uploadedAt.getTime() + retentionHours * HOUR_MS;
  let day = zonedDayKey(new Date(oldEnough), timeZone);
  // Two days are always enough: the day it becomes old enough, or the next one.
  for (let i = 0; i < 3; i += 1) {
    const at = zonedTimeOn(day, time, timeZone);
    if (!at) return null;
    if (at.getTime() > oldEnough) return at;
    day = nextDayKey(day);
  }
  return null;
}

/**
 * The moment a clean-up run stands for, in one workspace: the latest of the
 * schedule's times that has come today, or `now` for an interval schedule.
 *
 * ⚠ THE SCHEDULED MOMENT, NOT THE RUN'S CLOCK. The runner sweeps a daily
 * process every few minutes, so the same 10 PM is run more than once, and a
 * late run (after an outage) runs it at 11. Measured from 10 PM, every one of
 * those runs deletes exactly the files the on-time run would have — no file
 * goes early because a run came later, and running again deletes nothing new.
 */
export function fileCleanupMoment(
  schedule: { kind: 'interval' } | { kind: 'daily'; times: readonly string[] },
  now: Date,
  timeZone: string,
): Date {
  if (schedule.kind === 'interval') return now;
  const today = zonedDayKey(now, timeZone);
  let latest: Date | null = null;
  for (const time of schedule.times) {
    const at = zonedTimeOn(today, time, timeZone);
    if (!at || at.getTime() > now.getTime()) continue;
    if (!latest || at.getTime() > latest.getTime()) latest = at;
  }
  return latest ?? now;
}
