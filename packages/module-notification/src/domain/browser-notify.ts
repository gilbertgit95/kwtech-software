/**
 * When a SYSTEM pop-up (the browser's Notification API) is shown — for a person
 * whose every tab of the app is in the background.
 *
 * ⚠ Not when any tab is visible: that tab's toast already told them, and a
 * pop-up on top is the same event twice. And only from ONE tab: the tabs share
 * their visibility over a BroadcastChannel and the lowest id speaks. Electing a
 * leader alone is not enough — the leader can be a hidden tab while the person
 * reads another one.
 */

export interface TabPresence {
  /** A random id per tab, stable for its life. */
  tabId: string;
  visible: boolean;
  /** Epoch ms of its last heartbeat. A tab that closed without saying so ages out. */
  seenAt: number;
}

/** A tab that has not been heard from in this long is gone. */
export const NOTIFICATION_TAB_STALE_MS = 10_000;

export interface BrowserNotifyInput {
  /** The device setting (§11). */
  enabled: boolean;
  /** `Notification.permission`, or null where the API does not exist. */
  permission: 'default' | 'granted' | 'denied' | null;
  self: TabPresence;
  /** Every OTHER tab this one has heard from. */
  others: readonly TabPresence[];
  now: number;
}

/** Whether THIS tab should show a system pop-up for a notification that just arrived. */
export function shouldShowSystemPopup(input: BrowserNotifyInput): boolean {
  if (!input.enabled || input.permission !== 'granted') return false;
  if (input.self.visible) return false;
  const live = input.others.filter((tab) => input.now - tab.seenAt < NOTIFICATION_TAB_STALE_MS);
  if (live.some((tab) => tab.visible)) return false;
  // The lowest id among the tabs still alive speaks; the rest stay quiet.
  return live.every((tab) => input.self.tabId < tab.tabId);
}

/**
 * The OS-level tag. The same tag REPLACES an earlier pop-up rather than stacking
 * beside it — and a group keeps its row's id as it grows, so a growing group is
 * one pop-up, updated.
 */
export function systemPopupTag(notificationId: string): string {
  return `kwtech-notification:${notificationId}`;
}
