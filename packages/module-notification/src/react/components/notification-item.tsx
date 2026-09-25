'use client';

import { cn } from '@kwtech/web-ui/react';
import type { NotificationView } from '../notification-client.js';
import { relativeTime } from '../view/inbox-view.js';
import { severityLook } from '../view/severity-view.js';
import { NotificationIcon } from './notification-icons.js';

export interface NotificationItemProps {
  item: NotificationView;
  now: Date;
  /** The bell's panel and the compose preview: tighter padding, two lines of text. */
  compact?: boolean;
  /** A button or link on the row was used — the row is marked read. */
  onActivate?: (item: NotificationView) => void;
}

/**
 * One notification, as the bell's panel and the compose preview draw it. The
 * full inbox page has its own roomier row (`InboxRow`).
 *
 * Its buttons are real `<a>` elements: a link opens where it says (an external
 * one in a new tab, with `noopener noreferrer`), a download downloads. Both mark
 * the row read, because using a notification is reading it.
 *
 * ⚠ The body is rendered as TEXT. It is plain text by contract, and React
 * escapes it; nothing here ever sets HTML.
 */
export function NotificationItem({ item, now, compact = false, onActivate }: NotificationItemProps) {
  const look = severityLook(item.severity);
  const unread = item.readAt === null;
  const expired = item.expiresAt !== null && new Date(item.expiresAt).getTime() <= now.getTime();

  return (
    <article
      aria-label={`${look.label}: ${item.title}${unread ? ', unread' : ''}`}
      className={cn(
        'group relative flex gap-3 border-b border-border px-3 transition-colors last:border-b-0',
        compact ? 'py-2.5' : 'py-3',
        unread ? 'bg-accent/40' : 'bg-transparent',
      )}
    >
      <span className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-full', look.chip)}>
        <NotificationIcon name={look.icon} className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className={cn('min-w-0 flex-1 text-sm leading-snug', unread ? 'font-semibold' : 'font-medium')}>
            {item.title}
          </p>
          {unread ? <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" /> : null}
        </div>

        {item.body ? (
          <p
            className={cn('mt-0.5 whitespace-pre-line text-sm text-muted-foreground', compact ? 'line-clamp-2' : null)}
          >
            {item.body}
          </p>
        ) : null}

        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{item.sourceLabel}</span>
          {item.contextLabel ? (
            <span className="rounded border border-border px-1.5 py-px text-[0.6875rem]">{item.contextLabel}</span>
          ) : null}
          {item.groupCount > 1 ? <span>{item.groupCount} in this group</span> : null}
          <time dateTime={item.occurredAt} title={new Date(item.occurredAt).toLocaleString()}>
            {relativeTime(item.occurredAt, now)}
          </time>
        </p>

        {expired ? (
          <p className="mt-1.5 text-xs text-muted-foreground">The link on this notification has expired.</p>
        ) : null}

        {!expired && item.actions.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {item.actions.map((action) => {
              const external = action.kind === 'link' && action.target === 'blank';
              return (
                <a
                  key={action.key}
                  href={action.href}
                  {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  {...(action.kind === 'download' ? { download: action.filename ?? '' } : {})}
                  onClick={() => onActivate?.(item)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {action.label}
                  {action.kind === 'download' ? <NotificationIcon name="download" className="size-3.5" /> : null}
                  {external ? <NotificationIcon name="external" className="size-3.5" /> : null}
                  {external ? <span className="sr-only">(opens in a new tab)</span> : null}
                </a>
              );
            })}
          </div>
        ) : null}
      </div>
    </article>
  );
}
