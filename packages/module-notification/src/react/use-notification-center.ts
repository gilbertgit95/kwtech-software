'use client';

import { useRealtime, useRealtimeStatus } from '@kwtech/module-kit/react';
import { playTone } from '@kwtech/web-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type LiveIndicator, liveIndicator, nextIndicatorChangeIn } from '../domain/live-state.js';
import { missedSummaryText, planMissedToasts } from '../domain/toast.js';
import { NOTIFICATION_OPERATIONS } from '../operations.js';
import {
  createNotificationClient,
  type NotificationClient,
  type NotificationEventView,
  type NotificationView,
} from './notification-client.js';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationDeviceSettings,
  onNotificationSettings,
  readNotificationSettings,
} from './notification-settings.js';
import { useNotificationsPageOnScreen } from './notification-surface.js';
import { notificationTone } from './notification-tones.js';
import { NOTIFICATIONS_HREF } from './routes.js';
import { useSystemPopups } from './use-system-popups.js';
import { newestOccurredAt } from './view/inbox-view.js';
import { dismissToast, EMPTY_TOAST_QUEUE, pushToast, type ToastItem, type ToastQueue } from './view/toast-queue.js';

/** Items in the bell's panel. */
export const PANEL_SIZE = 10;

/** Events arriving together become one re-read. */
const REREAD_DEBOUNCE_MS = 200;

export interface NotificationCenterState {
  unreadCount: number;
  /** The panel's items, unread first. Null until the first load. */
  recent: NotificationView[] | null;
  error: string | null;
  toasts: ToastQueue;
  /** What the bell says about the connection. */
  live: LiveIndicator;
  /** When the current connection problem began (epoch ms). */
  liveSince: number;
  settings: NotificationDeviceSettings;
  dismissToast(id: string): void;
  /** Stop waiting out the backoff and reconnect now. */
  retryNow(): void;
  markRead(ids: readonly string[]): Promise<void>;
  markAllRead(): Promise<void>;
  reload(): Promise<void>;
}

/**
 * Everything the header needs, from ONE hook instance: the badge, the panel,
 * the toasts, the connection dot, the sound and the system pop-ups share one
 * socket subscription and agree on what is unread.
 *
 * ## The realtime contract
 *
 *   - `created` / `grouped` carry the notification: toast it, sound it, pop it
 *     up, then re-read the count and the panel.
 *   - `sync` opens every (re)connection. The FIRST is the initial load; every
 *     later one means the socket was down, so ask `notificationsSince` for what
 *     arrived meanwhile — alerts get their own toast, the rest one summary.
 *   - everything else: re-read.
 *
 * The count is always RE-READ, never counted locally: counting here would mean
 * a second copy of the server's rule for what counts as unread.
 */
export function useNotificationCenter(options: { client?: NotificationClient } = {}): NotificationCenterState {
  const client = useMemo(() => options.client ?? createNotificationClient(), [options.client]);
  const realtime = useRealtime();
  const status = useRealtimeStatus();
  const pageOnScreen = useNotificationsPageOnScreen();

  const [unreadCount, setUnreadCount] = useState(0);
  const [recent, setRecent] = useState<NotificationView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastQueue>(EMPTY_TOAST_QUEUE);
  const [settings, setSettings] = useState<NotificationDeviceSettings>(DEFAULT_NOTIFICATION_SETTINGS);

  // Read on mount, not in the initial state: the header renders on the server
  // first, where there is no localStorage, and a different first client render
  // would be a hydration mismatch.
  useEffect(() => {
    setSettings(readNotificationSettings());
    return onNotificationSettings(setSettings);
  }, []);

  const showSystemPopup = useSystemPopups(settings.systemPopups);

  /*
   * Refs for what the socket handler reads: the subscription is opened once per
   * connection, and a handler that closed over the first render's settings
   * would keep playing a sound somebody has since turned off.
   */
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pageOnScreenRef = useRef(pageOnScreen);
  pageOnScreenRef.current = pageOnScreen;
  const popupRef = useRef(showSystemPopup);
  popupRef.current = showSystemPopup;

  /**
   * The newest `occurredAt` this tab has seen — what the reconnect catch-up
   * asks "since". Seeded from the first load, or from this tab's clock when the
   * inbox was empty (the one place client and server clocks meet; a few
   * seconds of skew means at worst a notification counted in the summary that
   * had already been seen).
   */
  const lastSeen = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [count, page] = await Promise.all([
        client.unreadCount(),
        client.list({ first: PANEL_SIZE, order: 'unread_first' }),
      ]);
      setUnreadCount(count);
      setRecent(page.items);
      noteSeen(lastSeen, newestOccurredAt(page.items));
      if (lastSeen.current === null) lastSeen.current = new Date().toISOString();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your notifications.');
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const push = useCallback((toast: Omit<ToastItem, 'version'>) => setToasts((queue) => pushToast(queue, toast)), []);

  // ── the socket ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!realtime) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let syncedOnce = false;
    let cancelled = false;

    const reread = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), REREAD_DEBOUNCE_MS);
    };

    const announce = (item: NotificationView) => {
      noteSeen(lastSeen, item.occurredAt);
      // The full inbox shows it in place; a toast on top would be one event twice.
      if (pageOnScreenRef.current) return;
      const current = settingsRef.current;
      if (current.toasts) push(toastFor(item));
      // An alert is a little louder: the one kind that must be noticed from across the room.
      if (current.sound) playTone(notificationTone(current.tone), item.severity === 'alert' ? { peak: 0.22 } : {});
      popupRef.current(item);
    };

    const catchUp = async () => {
      const since = lastSeen.current;
      if (!since) return;
      try {
        const missed = await client.since(since);
        if (cancelled || missed.total === 0) return;
        for (const item of missed.items) noteSeen(lastSeen, item.occurredAt);
        if (pageOnScreenRef.current || !settingsRef.current.toasts) return;
        const plan = planMissedToasts(
          missed.items.map((item) => ({ ...item, severity: asSeverity(item.severity) })),
          missed.total,
        );
        // ⚠ Each missed alert gets its own toast; the rest share one summary.
        for (const alert of plan.alerts) push(toastFor(alert));
        if (plan.summaryCount > 0) {
          push({
            id: 'missed-summary',
            severity: 'info',
            title: missedSummaryText(plan.summaryCount),
            body: null,
            sourceLabel: 'Notifications',
            contextLabel: null,
            href: NOTIFICATIONS_HREF,
            hrefTarget: 'self',
          });
        }
      } catch {
        // The catch-up is a courtesy on top of the re-read below, which is what
        // actually brings the inbox up to date. A failure here costs the summary.
      }
    };

    const unsubscribe = realtime.subscribe<{ notificationEvents: NotificationEventView }>(
      NOTIFICATION_OPERATIONS.notificationEvents,
      ({ notificationEvents: event }) => {
        switch (event.kind) {
          case 'sync':
            if (syncedOnce) void catchUp();
            syncedOnce = true;
            reread();
            return;
          case 'created':
          case 'grouped':
            if (event.notification) announce(event.notification);
            reread();
            return;
          case 'recalled':
            // Gone from every inbox — including off the screen, right now.
            setToasts((queue) => {
              let next = queue;
              for (const id of event.ids) next = dismissToast(next, id);
              return next;
            });
            reread();
            return;
          default:
            reread();
        }
      },
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [realtime, client, load, push]);

  // ── the connection dot ──────────────────────────────────────────────────
  const [live, setLive] = useState<LiveIndicator>('none');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Re-read now, then set ONE timer for the next time the indicator changes
    // by itself (3 s, then 30 s) — never a poll.
    const update = () => {
      const at = Date.now();
      setLive(liveIndicator(status?.status ?? null, status?.since ?? 0, at));
      const wait = status ? nextIndicatorChangeIn(status.status, status.since, at) : null;
      if (wait !== null) timer = setTimeout(update, wait + 50);
    };
    update();
    return () => clearTimeout(timer);
  }, [status]);

  const retryNow = useCallback(() => realtime?.reconnectNow?.(), [realtime]);

  // ⚠ STABLE, because every toast's timer depends on it: a new function each
  // render would restart every toast's clock whenever the count re-read.
  const dismiss = useCallback((id: string) => setToasts((queue) => dismissToast(queue, id)), []);

  const markRead = useCallback(
    async (ids: readonly string[]) => {
      if (ids.length === 0) return;
      try {
        await client.markRead(ids);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not mark it read.');
      }
      await load();
    },
    [client, load],
  );

  const markAllRead = useCallback(async () => {
    const before = lastSeen.current ?? new Date().toISOString();
    try {
      await client.markAllRead(before);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not mark them read.');
    }
    await load();
  }, [client, load]);

  return {
    unreadCount,
    recent,
    error,
    toasts,
    live,
    liveSince: status?.since ?? 0,
    settings,
    dismissToast: dismiss,
    retryNow,
    markRead,
    markAllRead,
    reload: load,
  };
}

/** A notification as a toast: clicking it follows its first link, if it has one. */
export function toastFor(item: NotificationView): Omit<ToastItem, 'version'> {
  const link = item.actions.find((action) => action.kind === 'link');
  return {
    id: item.id,
    severity: item.severity,
    title: item.title,
    body: item.body,
    sourceLabel: item.sourceLabel,
    contextLabel: item.contextLabel,
    href: link?.href ?? null,
    hrefTarget: link?.target ?? null,
  };
}

/** Moves the high-water mark forward, never back. */
function noteSeen(mark: { current: string | null }, iso: string | null): void {
  if (iso && (mark.current === null || iso > mark.current)) mark.current = iso;
}

function asSeverity(value: string): 'info' | 'success' | 'warning' | 'alert' {
  return value === 'success' || value === 'warning' || value === 'alert' ? value : 'info';
}
