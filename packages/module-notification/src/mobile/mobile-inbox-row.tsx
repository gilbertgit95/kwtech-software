'use client';

import { cn } from '@kwtech/web-ui/react';
import { useState } from 'react';
import { NotificationIcon } from '../react/components/notification-icons.js';
import type { NotificationView } from '../react/notification-client.js';
import { isLongBody, relativeTime } from '../react/view/inbox-view.js';
import { severityLook } from '../react/view/severity-view.js';

/**
 * One notification on the phone's Inbox (issue #22): a card, with its tools
 * one tap away.
 *
 * The desktop row shows its tools on HOVER, which a phone does not have; here
 * a "⋯" button on every card opens them under it — Mark as read or unread,
 * Archive or Move back. The action buttons the notification carries (Open
 * the task, Download) are always shown, full width when there is one, as the
 * desktop row shows them. The unread bar on the leading edge is the same mark.
 */
export function MobileInboxRow({
  item,
  now,
  onActivate,
  onMarkRead,
  onMarkUnread,
  onArchive,
  onUnarchive,
}: {
  item: NotificationView;
  now: Date;
  onActivate: (item: NotificationView) => void;
  onMarkRead: (item: NotificationView) => void;
  onMarkUnread: (item: NotificationView) => void;
  onArchive: (item: NotificationView) => void;
  onUnarchive: (item: NotificationView) => void;
}) {
  const look = severityLook(item.severity);
  const unread = item.readAt === null;
  const archived = item.archivedAt !== null;
  const expired = item.expiresAt !== null && new Date(item.expiresAt).getTime() <= now.getTime();
  const long = isLongBody(item.body);
  const [expanded, setExpanded] = useState(false);
  const [tools, setTools] = useState(false);

  return (
    <li
      className={cn(
        'relative overflow-hidden rounded-2xl border bg-card shadow-sm transition-colors',
        unread ? 'border-primary/25' : 'border-border/70',
      )}
    >
      {unread ? <span aria-hidden className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-primary" /> : null}

      <div className="flex gap-3 p-4">
        <span aria-hidden className={cn('grid size-10 shrink-0 place-items-center rounded-full', look.chip)}>
          <NotificationIcon name={look.icon} className="size-[1.125rem]" />
        </span>

        <article aria-label={`${look.label}: ${item.title}${unread ? ', unread' : ''}`} className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h3
              className={cn(
                'min-w-0 flex-1 text-[0.9375rem] leading-snug text-card-foreground',
                unread ? 'font-semibold' : 'font-medium',
              )}
            >
              {item.title}
            </h3>
            <button
              type="button"
              onClick={() => setTools((open) => !open)}
              aria-expanded={tools}
              aria-label={`Actions for “${item.title}”`}
              className="-mt-1.5 -mr-2 grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span aria-hidden className="text-lg leading-none">
                ⋯
              </span>
            </button>
          </div>

          <p className="mt-0.5 text-xs text-muted-foreground">
            <time dateTime={item.occurredAt}>{relativeTime(item.occurredAt, now)}</time>
            {' · '}
            {item.sourceLabel}
            {item.contextLabel ? ` · ${item.contextLabel}` : null}
            {item.groupCount > 1 ? ` · ${item.groupCount} grouped` : null}
          </p>

          {item.body ? (
            <div className="mt-2">
              <p
                className={cn(
                  'whitespace-pre-line break-words text-sm text-muted-foreground',
                  long && !expanded ? 'line-clamp-3' : null,
                )}
              >
                {item.body}
              </p>
              {long ? (
                <button
                  type="button"
                  onClick={() => setExpanded((current) => !current)}
                  aria-expanded={expanded}
                  className="mt-1 text-xs font-medium text-primary"
                >
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              ) : null}
            </div>
          ) : null}

          {expired ? <p className="mt-2 text-xs italic text-muted-foreground">Link expired</p> : null}

          {!expired && item.actions.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {item.actions.map((action, index) => {
                const external = action.kind === 'link' && action.target === 'blank';
                return (
                  <a
                    key={action.key}
                    href={action.href}
                    {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    {...(action.kind === 'download' ? { download: action.filename ?? '' } : {})}
                    onClick={() => onActivate(item)}
                    className={cn(
                      'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      // The first button is the main one; any others are secondary.
                      index === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground active:bg-accent',
                      item.actions.length === 1 ? 'w-full' : null,
                    )}
                  >
                    {action.kind === 'download' ? <NotificationIcon name="download" className="size-4" /> : null}
                    {action.label}
                    {external ? <NotificationIcon name="external" className="size-4" /> : null}
                    {external ? <span className="sr-only">(opens in a new tab)</span> : null}
                  </a>
                );
              })}
            </div>
          ) : null}
        </article>
      </div>

      {tools ? (
        <div className="flex divide-x divide-border/70 border-t border-border/70 animate-in fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none">
          {archived ? (
            <RowTool icon="refresh" label="Move to inbox" onClick={() => onUnarchive(item)} />
          ) : (
            <>
              {unread ? (
                <RowTool icon="check" label="Mark as read" onClick={() => onMarkRead(item)} />
              ) : (
                <RowTool icon="unread" label="Mark as unread" onClick={() => onMarkUnread(item)} />
              )}
              <RowTool icon="archive" label="Archive" onClick={() => onArchive(item)} />
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

function RowTool({
  icon,
  label,
  onClick,
}: {
  icon: 'check' | 'unread' | 'archive' | 'refresh';
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 flex-1 items-center justify-center gap-2 text-sm font-medium text-foreground transition-colors active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <NotificationIcon name={icon} className="size-4" />
      {label}
    </button>
  );
}
