'use client';

import { cn } from '@kwtech/web-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pausedSentence } from '../../domain/live-state.js';
import { badgeText, bellLabel } from '../../domain/unread.js';
import type { NotificationClient, NotificationView } from '../notification-client.js';
import { NOTIFICATION_PREFERENCES_HREF, NOTIFICATIONS_HREF } from '../routes.js';
import { useNotificationCenter } from '../use-notification-center.js';
import { useTabTitle } from '../use-tab-title.js';
import { NotificationIcon } from './notification-icons.js';
import { NotificationItem } from './notification-item.js';
import { ToastStack } from './toast-stack.js';

/**
 * The bell in the app header: the live unread count, a dot when the connection
 * is not live, a panel of the latest notifications, and the toasts.
 *
 * Contributed as a header TOOL and rendered with no props, which is why it
 * builds its own client. ONE `useNotificationCenter` serves the bell, the
 * panel, the toasts and the tab title, so they agree and share one socket
 * subscription.
 *
 * It knows nothing about any other header tool. Placed after chat's by its
 * `order`, alone when chat is off.
 */
export function NotificationHeaderTool({ client }: { client?: NotificationClient } = {}) {
  const center = useNotificationCenter(client ? { client } : {});
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());

  useTabTitle(center.unreadCount);

  // Relative times ("5 min ago") refreshed while the panel is open, and only then.
  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, [open]);

  // Closing on Escape and on a press outside — the popover conventions.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPress = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [open]);

  const { markRead, dismissToast } = center;
  const activate = useCallback(
    (item: NotificationView) => {
      if (item.readAt === null) void markRead([item.id]);
    },
    [markRead],
  );
  const openToast = useCallback(
    (id: string) => {
      // The "while you were offline" summary is not a notification; there is nothing to mark.
      if (id !== 'missed-summary') void markRead([id]);
      dismissToast(id);
    },
    [markRead, dismissToast],
  );

  const badge = badgeText(center.unreadCount);
  const liveDot = center.live === 'none' ? null : center.live;
  const label = useMemo(() => {
    const base = bellLabel(center.unreadCount);
    if (liveDot === 'paused') return `${base}. Live updates paused.`;
    if (liveDot === 'reconnecting') return `${base}. Reconnecting.`;
    return base;
  }, [center.unreadCount, liveDot]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        title="Notifications"
        className={cn(
          'relative grid size-9 place-items-center rounded-md text-muted-foreground transition-colors',
          'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          open && 'bg-accent text-foreground',
        )}
      >
        <NotificationIcon name="bell" className="size-[1.125rem]" />
        {badge ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[0.625rem] font-semibold leading-none text-primary-foreground ring-2 ring-card"
          >
            {badge}
          </span>
        ) : null}
        {liveDot ? (
          <span
            aria-hidden
            className={cn(
              'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card',
              liveDot === 'paused' ? 'bg-status-warning-foreground' : 'bg-muted-foreground',
            )}
          />
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full z-50 mt-2 flex max-h-[min(34rem,calc(100dvh-5rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <h2 className="text-sm font-semibold">Notifications</h2>
            <div className="flex items-center gap-1">
              {center.unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={() => void center.markAllRead()}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <NotificationIcon name="check-all" className="size-3.5" />
                  Mark all read
                </button>
              ) : null}
              <a
                href={NOTIFICATION_PREFERENCES_HREF}
                aria-label="Notification settings"
                title="Notification settings"
                className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <NotificationIcon name="settings" className="size-4" />
              </a>
            </div>
          </div>

          {liveDot ? (
            <div
              role="status"
              className={cn(
                'flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs',
                liveDot === 'paused' ? 'bg-status-warning text-status-warning-foreground' : 'text-muted-foreground',
              )}
            >
              <span>
                {liveDot === 'paused'
                  ? pausedSentence(center.liveSince)
                  : 'Reconnecting… new notifications will appear when it is back.'}
              </span>
              {liveDot === 'paused' ? (
                <button
                  type="button"
                  onClick={center.retryNow}
                  className="shrink-0 rounded-md border border-current px-2 py-0.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Retry now
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {center.recent === null ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
            ) : center.recent.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">You have no notifications.</p>
            ) : (
              center.recent.map((item) => (
                <NotificationItem key={item.id} item={item} now={now} compact onActivate={activate} />
              ))
            )}
          </div>

          {center.error ? (
            <p role="alert" className="border-t border-border bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {center.error}
            </p>
          ) : null}
          <a
            href={NOTIFICATIONS_HREF}
            className="border-t border-border px-3 py-2.5 text-center text-sm font-medium text-primary hover:bg-accent/60"
          >
            View all notifications
          </a>
        </div>
      ) : null}

      <ToastStack queue={center.toasts} onDismiss={center.dismissToast} onOpen={openToast} />
    </div>
  );
}
