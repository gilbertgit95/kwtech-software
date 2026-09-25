import type { NotificationSeverity } from '../types.js';

/**
 * Toasts: how long each stays, how loudly it is announced, and what happens to
 * the notifications that arrived while the tab was not live.
 */

/**
 * How long a toast stays, in milliseconds.
 *
 * ⚠ SHORT, by the operator's decision (2026-09-25): a toast is a NUDGE — "you
 * have a new notification" — not the place to read it. The notification stays
 * in the inbox and on the bell's count, so nothing is lost when the toast
 * goes; what a long toast costs is the view it covers. Hovering pauses it for
 * somebody who does want to read it there.
 *
 * Warnings and alerts get a second longer. They leave by themselves too: an
 * earlier rule kept alerts until dismissed, and a pop-up nobody closed sat
 * over the page.
 */
export function toastDurationMs(severity: NotificationSeverity): number {
  switch (severity) {
    case 'info':
    case 'success':
      return 2_000;
    case 'warning':
    case 'alert':
      return 3_000;
  }
}

/**
 * The live region a toast is announced in. An alert interrupts a screen reader;
 * everything else waits its turn.
 */
export function toastPoliteness(severity: NotificationSeverity): 'polite' | 'assertive' {
  return severity === 'alert' ? 'assertive' : 'polite';
}

/**
 * At most this many toasts on screen; the rest wait their turn. Two, so a burst
 * never stacks into a wall across the top of the page.
 */
export const NOTIFICATION_VISIBLE_TOASTS = 2;

/**
 * What to show for notifications that arrived while the tab was not live.
 *
 * ⚠ Each ALERT gets its own toast: missing one because the Wi-Fi dropped is
 * exactly the failure this module exists to prevent. Everything else
 * becomes ONE summary, instead of either nothing or a burst of stale toasts the
 * moment a laptop opens.
 */
export function planMissedToasts<T extends { severity: NotificationSeverity }>(
  missed: readonly T[],
  totalMissed: number,
): { alerts: T[]; summaryCount: number } {
  const alerts = missed.filter((item) => item.severity === 'alert');
  // `totalMissed` can exceed what was fetched; alerts are subtracted from the
  // total, so the summary counts exactly what did not get a toast of its own.
  const summaryCount = Math.max(0, totalMissed - alerts.length);
  return { alerts, summaryCount };
}

/** The summary toast's sentence. */
export function missedSummaryText(count: number): string {
  return count === 1
    ? '1 notification arrived while you were offline.'
    : `${count} notifications arrived while you were offline.`;
}
