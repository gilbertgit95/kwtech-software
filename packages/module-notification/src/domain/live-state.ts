/**
 * What the bell says about the connection.
 *
 * module-kit reports the socket's state and when it began; how long counts as
 * a problem is THIS screen's decision. The bell draws two lines:
 *
 *   reconnecting for more than 3 s   a quiet grey dot — "Reconnecting…"
 *   reconnecting for more than 30 s  a warning dot — "Live updates paused"
 *
 * ⚠ The three seconds are what stops the dot flickering on the routine
 * reconnect every socket makes when its authorization expires. The thirty are
 * where a person would start to wonder, so that is where the bell says it
 * first.
 */

export const NOTIFICATION_RECONNECTING_AFTER_MS = 3_000;
export const NOTIFICATION_PAUSED_AFTER_MS = 30_000;

/** The subset of module-kit's `RealtimeStatus` this rule reads — structural, so the domain imports nothing. */
export type ConnectionStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'refused';

export type LiveIndicator = 'none' | 'reconnecting' | 'paused';

/**
 * The indicator for a status that began at `since` (epoch ms), seen at `now`.
 *
 * ⚠ `refused` is PAUSED at once: the server declined the socket (signed out),
 * nothing will retry it, and a bell showing nothing would be claiming a live
 * connection that will never come back.
 *
 * `null` status means there is no socket to ask about — an app that wires
 * none. That shows nothing: the inbox still works over HTTP there, and a
 * permanent warning dot would be noise about a choice the app made.
 */
export function liveIndicator(status: ConnectionStatus | null, since: number, now: number): LiveIndicator {
  if (status === null) return 'none';
  switch (status) {
    case 'idle':
    case 'live':
      return 'none';
    case 'refused':
      return 'paused';
    case 'connecting':
    case 'reconnecting': {
      const elapsed = now - since;
      if (elapsed >= NOTIFICATION_PAUSED_AFTER_MS) return 'paused';
      if (elapsed >= NOTIFICATION_RECONNECTING_AFTER_MS) return 'reconnecting';
      return 'none';
    }
  }
}

/** When the indicator will next change by itself, in ms from now — so a screen can set one timer, not poll. */
export function nextIndicatorChangeIn(status: ConnectionStatus | null, since: number, now: number): number | null {
  if (status !== 'connecting' && status !== 'reconnecting') return null;
  const elapsed = now - since;
  if (elapsed < NOTIFICATION_RECONNECTING_AFTER_MS) return NOTIFICATION_RECONNECTING_AFTER_MS - elapsed;
  if (elapsed < NOTIFICATION_PAUSED_AFTER_MS) return NOTIFICATION_PAUSED_AFTER_MS - elapsed;
  return null;
}

/** "Live updates paused since 10:42." — the clock in the viewer's own locale. */
export function pausedSentence(since: number): string {
  const time = new Date(since).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `Live updates paused since ${time}. New notifications will appear when the connection is back.`;
}
