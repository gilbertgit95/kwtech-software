/**
 * The flood rule: a producer stuck in a loop becomes ONE row, not ten thousand.
 *
 * Counted per recipient per source over the last minute, in the database — so a
 * restart does not reset it and two replicas share it. Past the limit, items
 * fold into an overflow group (`overflowGroup`) instead of being dropped: the
 * person sees that something is happening, and the log is where the loop gets
 * noticed.
 */

/** The window the count covers. */
export const NOTIFICATION_FLOOD_WINDOW_MS = 60_000;

/**
 * Items per source per person per minute when the app configures nothing.
 *
 * ⚠ A FLOOR, never "unlimited": an app that forgot to configure it still gets
 * the protection, which is the only direction this can fail safely.
 */
export const NOTIFICATION_FLOOD_FLOOR = 20;

/**
 * The limit in force. A missing, non-integer or non-positive value falls back
 * to the floor rather than to "no limit".
 */
export function resolveFloodLimit(configured: number | undefined): number {
  if (configured === undefined || !Number.isInteger(configured) || configured < 1) return NOTIFICATION_FLOOD_FLOOR;
  return configured;
}

/** Whether one more from this source would be past the limit. */
export function isFlooded(recentFromSource: number, limit: number): boolean {
  return recentFromSource >= limit;
}

/** Where the counted window starts. */
export function floodWindowStart(now: Date): Date {
  return new Date(now.getTime() - NOTIFICATION_FLOOD_WINDOW_MS);
}
