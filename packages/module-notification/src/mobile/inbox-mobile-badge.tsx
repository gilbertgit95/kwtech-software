'use client';

import { useCallback } from 'react';
import { badgeText, bellLabel } from '../domain/unread.js';
import { ToastStack } from '../react/components/toast-stack.js';
import { useNotificationCenter } from '../react/use-notification-center.js';
import { useTabTitle } from '../react/use-tab-title.js';

/**
 * The Inbox tab's badge — and, because it is always mounted, the phone's ONE
 * notification centre (issue #22): the live unread count on the icon, the
 * toasts, and the tab title, from one `useNotificationCenter`, as the bell is
 * on the desktop. A second centre elsewhere would open a second subscription
 * and disagree about what is unread.
 */
export function InboxMobileBadge() {
  const center = useNotificationCenter();
  useTabTitle(center.unreadCount);
  const { markRead, dismissToast } = center;

  const openToast = useCallback(
    (id: string) => {
      // The "while you were offline" summary is not a notification; there is nothing to mark.
      if (id !== 'missed-summary') void markRead([id]);
      dismissToast(id);
    },
    [markRead, dismissToast],
  );

  const text = badgeText(center.unreadCount);
  return (
    <>
      {text ? (
        <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-primary px-1 text-[0.625rem] font-semibold leading-none text-primary-foreground">
          <span aria-hidden>{text}</span>
          <span className="sr-only">{bellLabel(center.unreadCount)}</span>
        </span>
      ) : null}
      <ToastStack queue={center.toasts} onDismiss={dismissToast} onOpen={openToast} />
    </>
  );
}
