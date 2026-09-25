'use client';

import { cn } from '@kwtech/web-ui/react';
import { useState } from 'react';
import type { NotificationView } from '../notification-client.js';
import { isLongBody, relativeTime } from '../view/inbox-view.js';
import { severityLook } from '../view/severity-view.js';
import { NotificationIcon } from './notification-icons.js';

export interface InboxRowProps {
  item: NotificationView;
  now: Date;
  selected: boolean;
  /** True while anything is selected: the checkboxes stay visible instead of appearing on hover. */
  selecting: boolean;
  onToggle: () => void;
  /** A button on the row was used — the row is marked read. */
  onActivate: (item: NotificationView) => void;
  onMarkRead: (item: NotificationView) => void;
  onMarkUnread: (item: NotificationView) => void;
  onArchive: (item: NotificationView) => void;
  onUnarchive: (item: NotificationView) => void;
}

/**
 * One notification on the full inbox page — roomier than the bell's panel row,
 * with its tools on hover (and always on keyboard focus) so a long list reads
 * as a list rather than as a wall of buttons.
 *
 * ⚠ The body is TEXT, rendered by React, never HTML.
 */
export function InboxRow({
  item,
  now,
  selected,
  selecting,
  onToggle,
  onActivate,
  onMarkRead,
  onMarkUnread,
  onArchive,
  onUnarchive,
}: InboxRowProps) {
  const look = severityLook(item.severity);
  const unread = item.readAt === null;
  const archived = item.archivedAt !== null;
  const expired = item.expiresAt !== null && new Date(item.expiresAt).getTime() <= now.getTime();
  const long = isLongBody(item.body);
  const [expanded, setExpanded] = useState(false);

  return (
    <li
      className={cn(
        'group relative flex gap-3 px-4 py-3.5 transition-colors sm:px-5',
        selected ? 'bg-primary/5' : unread ? 'bg-accent/30 hover:bg-accent/50' : 'hover:bg-accent/30',
      )}
    >
      {/* The unread accent: a bar on the leading edge, readable at a glance down the list. */}
      {unread ? <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary" /> : null}

      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        aria-label={`Select “${item.title}”`}
        className={cn(
          'mt-2 size-4 shrink-0 accent-primary transition-opacity',
          selecting || selected ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
        )}
      />

      <span className={cn('mt-0.5 grid size-9 shrink-0 place-items-center rounded-full', look.chip)} title={look.label}>
        <NotificationIcon name={look.icon} className="size-4" />
      </span>

      <article aria-label={`${look.label}: ${item.title}${unread ? ', unread' : ''}`} className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <h3 className={cn('min-w-0 flex-1 text-sm leading-snug', unread ? 'font-semibold' : 'font-medium')}>
            {item.title}
          </h3>
          <time
            dateTime={item.occurredAt}
            title={new Date(item.occurredAt).toLocaleString()}
            className="shrink-0 pt-0.5 text-xs text-muted-foreground group-hover:hidden group-focus-within:hidden"
          >
            {relativeTime(item.occurredAt, now)}
          </time>
        </div>

        {item.body ? (
          <div className="mt-1">
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
                className="mt-0.5 text-xs font-medium text-primary hover:underline"
              >
                {expanded ? 'Show less' : 'Show more'}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{item.sourceLabel}</span>
          {item.contextLabel ? (
            <span className="rounded-full border border-border px-2 py-0.5">{item.contextLabel}</span>
          ) : null}
          {item.groupCount > 1 ? (
            <span className="rounded-full border border-border px-2 py-0.5">{item.groupCount} grouped</span>
          ) : null}
          {expired ? <span className="px-1 italic">Link expired</span> : null}
        </div>

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
                    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    // The first button is the main one; any others are secondary.
                    index === 0
                      ? 'bg-primary text-primary-foreground hover:opacity-90'
                      : 'border border-border bg-card hover:bg-accent',
                  )}
                >
                  {action.kind === 'download' ? <NotificationIcon name="download" className="size-3.5" /> : null}
                  {action.label}
                  {external ? <NotificationIcon name="external" className="size-3.5" /> : null}
                  {external ? <span className="sr-only">(opens in a new tab)</span> : null}
                </a>
              );
            })}
          </div>
        ) : null}
      </article>

      {/* Tools: shown on hover and on keyboard focus, in the time's place. */}
      <div className="absolute right-3 top-3 hidden items-center gap-0.5 rounded-lg border border-border bg-popover p-0.5 shadow-sm group-focus-within:flex group-hover:flex sm:right-4">
        {archived ? (
          <RowTool label="Move back to inbox" icon="refresh" onClick={() => onUnarchive(item)} />
        ) : (
          <>
            {unread ? (
              <RowTool label="Mark as read" icon="check" onClick={() => onMarkRead(item)} />
            ) : (
              <RowTool label="Mark as unread" icon="unread" onClick={() => onMarkUnread(item)} />
            )}
            <RowTool label="Archive" icon="archive" onClick={() => onArchive(item)} />
          </>
        )}
      </div>
    </li>
  );
}

function RowTool({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: 'check' | 'unread' | 'archive' | 'refresh';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <NotificationIcon name={icon} className="size-4" />
    </button>
  );
}
