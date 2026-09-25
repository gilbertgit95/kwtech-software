'use client';

import { useCallback, useEffect, useRef } from 'react';
import { shouldShowSystemPopup, systemPopupTag, type TabPresence } from '../domain/browser-notify.js';
import type { NotificationView } from './notification-client.js';
import { NOTIFICATIONS_HREF } from './routes.js';

/** How often a tab tells the others it is alive, and whether it is visible. */
const HEARTBEAT_MS = 3_000;
const CHANNEL = 'kwtech-notification-tabs';

/**
 * The browser's own pop-up, for a person whose every tab of the app is in the
 * background. The Notification API — NOT Web Push: it needs no service worker
 * and no server, and it only works while a tab is open, which is the promise.
 *
 * The tabs share their visibility over a `BroadcastChannel`; see
 * `shouldShowSystemPopup` for who speaks. Without `BroadcastChannel` a tab
 * knows only itself, and the OS `tag` is what stops duplicates.
 *
 * ⚠ Permission is never requested here. Only a button on the preferences page
 * asks — browsers penalise prompts nobody triggered, and an unprompted dialog on
 * page load is how the answer becomes "Block" forever.
 */
export function useSystemPopups(enabled: boolean): (item: NotificationView) => void {
  const tabId = useRef<string>('');
  const others = useRef(new Map<string, TabPresence>());
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    tabId.current = crypto.randomUUID();
    if (typeof BroadcastChannel === 'undefined') return;

    const channel = new BroadcastChannel(CHANNEL);
    const tabs = others.current;
    const announce = () =>
      channel.postMessage({
        tabId: tabId.current,
        visible: document.visibilityState === 'visible',
        seenAt: Date.now(),
      } satisfies TabPresence);
    channel.onmessage = (event: MessageEvent<TabPresence>) => {
      const presence = event.data;
      if (!presence || typeof presence.tabId !== 'string' || presence.tabId === tabId.current) return;
      // Stamped with THIS tab's clock on arrival: two tabs' clocks are the same
      // machine's, but a message that sat in a throttled background queue is
      // news now, not when it was written.
      tabs.set(presence.tabId, { tabId: presence.tabId, visible: Boolean(presence.visible), seenAt: Date.now() });
    };
    announce();
    const timer = setInterval(announce, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', announce);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', announce);
      channel.close();
      tabs.clear();
    };
  }, []);

  return useCallback((item: NotificationView) => {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
    const show = shouldShowSystemPopup({
      enabled: enabledRef.current,
      permission: Notification.permission,
      self: { tabId: tabId.current, visible: document.visibilityState === 'visible', seenAt: Date.now() },
      others: [...others.current.values()],
      now: Date.now(),
    });
    if (!show) return;

    /*
     * ⚠ The title and where it came from — never the body. The OS draws this on
     * a lock screen and in a notification centre, which are outside the app and
     * outside anything a recall can reach.
     */
    const popup = new Notification(item.title, {
      body: [item.sourceLabel, item.contextLabel].filter(Boolean).join(' · '),
      tag: systemPopupTag(item.id),
    });
    popup.onclick = () => {
      window.focus();
      const link = item.actions.find((action) => action.kind === 'link');
      window.location.assign(link?.href.startsWith('/') ? link.href : NOTIFICATIONS_HREF);
      popup.close();
    };
  }, []);
}
