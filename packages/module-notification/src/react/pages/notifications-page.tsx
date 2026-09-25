'use client';

import { cn } from '@kwtech/web-ui/react';
import { useEffect, useId, useState } from 'react';
import { NOTIFICATION_SEVERITIES } from '../../types.js';
import { InboxRow } from '../components/inbox-row.js';
import { NotificationIcon } from '../components/notification-icons.js';
import type { NotificationClient, NotificationView } from '../notification-client.js';
import { useRegisterNotificationsPage } from '../notification-surface.js';
import { NOTIFICATION_PREFERENCES_HREF } from '../routes.js';
import { useNotificationInbox } from '../use-notification-inbox.js';
import {
  activeFilterCount,
  emptyInboxCopy,
  groupByDay,
  INBOX_PAGE_SIZES,
  type InboxTab,
  pagerLabel,
} from '../view/inbox-view.js';
import { severityLook } from '../view/severity-view.js';

const TABS: ReadonlyArray<{ tab: InboxTab; label: string }> = [
  { tab: 'all', label: 'All' },
  { tab: 'unread', label: 'Unread' },
  { tab: 'archived', label: 'Archived' },
];

/**
 * `/notifications` — the whole inbox, a page at a time.
 *
 * Unread first by default, with a "Newest first" order for finding what
 * happened when. Its filters, order, page size and position live in the URL,
 * so Back and a shared link restore them. While it is open the bell stays
 * quiet: new notifications appear here, and a toast on top would be one event
 * shown twice.
 */
export function NotificationsPage({ client }: { client?: NotificationClient } = {}) {
  useRegisterNotificationsPage();
  const inbox = useNotificationInbox(client ? { client } : {});
  const { state, page } = inbox;
  const [now, setNow] = useState(() => new Date());
  const ids = useId();

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const items = page?.items ?? [];
  const selectedIds = [...inbox.selected];
  const selecting = selectedIds.length > 0;
  const allSelected = items.length > 0 && items.every((item) => inbox.selected.has(item.id));
  const archivedTab = state.tab === 'archived';
  const filters = activeFilterCount(state);
  const unread = page?.unreadCount ?? 0;
  const empty = emptyInboxCopy(state);

  const activate = (item: NotificationView) => {
    if (item.readAt === null) void inbox.markRead([item.id]);
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 pb-24">
      {/* ── heading ─────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <NotificationIcon name="bell" className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {page === null
                ? 'Loading…'
                : unread === 0
                  ? 'You’re all caught up'
                  : `${unread.toLocaleString('en-US')} unread across all your organizations`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && !archivedTab ? (
            <button
              type="button"
              onClick={() => void inbox.markAllRead()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <NotificationIcon name="check-all" className="size-4" />
              Mark all read
            </button>
          ) : null}
          <a
            href={NOTIFICATION_PREFERENCES_HREF}
            aria-label="Notification settings"
            title="Notification settings"
            className="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <NotificationIcon name="settings" className="size-4" />
          </a>
        </div>
      </header>

      {/* ── tabs and filters ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          role="tablist"
          aria-label="Show"
          className="inline-flex w-fit rounded-lg border border-border bg-muted/40 p-1"
        >
          {TABS.map(({ tab, label }) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={state.tab === tab}
              onClick={() => inbox.setFilter({ tab })}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                state.tab === tab
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
              {tab === 'unread' && unread > 0 ? (
                <span className="rounded-full bg-primary px-1.5 text-[0.6875rem] font-semibold leading-4 text-primary-foreground">
                  {unread > 99 ? '99+' : unread}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PillSelect
            id={`${ids}-order`}
            label="Order"
            value={state.order}
            onChange={(value) => inbox.setFilter({ order: value === 'newest' ? 'newest' : 'unread_first' })}
            options={[
              { value: 'unread_first', label: 'Unread first' },
              { value: 'newest', label: 'Newest first' },
            ]}
          />
          <PillSelect
            id={`${ids}-type`}
            label="Type"
            value={state.severity ?? ''}
            active={state.severity !== null}
            onChange={(value) => inbox.setFilter({ severity: value || null })}
            options={[
              { value: '', label: 'All types' },
              ...NOTIFICATION_SEVERITIES.map((severity) => ({ value: severity, label: severityLook(severity).label })),
            ]}
          />
          {inbox.sources.length > 1 ? (
            <PillSelect
              id={`${ids}-source`}
              label="Source"
              value={state.source ?? ''}
              active={state.source !== null}
              onChange={(value) => inbox.setFilter({ source: value || null })}
              options={[
                { value: '', label: 'All sources' },
                ...inbox.sources.map((source) => ({ value: source.key, label: source.label })),
              ]}
            />
          ) : null}
          <PillSelect
            id={`${ids}-from`}
            label="From"
            value={state.from ?? ''}
            active={state.from !== null}
            onChange={(value) => inbox.setFilter({ from: value || null })}
            options={[
              { value: '', label: 'Everywhere' },
              { value: 'global', label: 'Platform-wide' },
              ...inbox.organizations.map((org) => ({ value: org.id, label: org.label })),
            ]}
          />
          {filters > 0 ? (
            <button
              type="button"
              onClick={() => inbox.setFilter({ severity: null, source: null, from: null })}
              className="rounded-full px-2.5 py-1 text-sm font-medium text-primary hover:bg-primary/10"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </div>

      {/* ── notices ─────────────────────────────────────────────────────── */}
      {inbox.arrived > 0 ? (
        <div className="sticky top-2 z-10 flex justify-center">
          <button
            type="button"
            onClick={inbox.backToTop}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-lg hover:opacity-90"
          >
            <NotificationIcon name="previous" className="size-4 rotate-90" />
            {inbox.arrived === 1 ? '1 new notification' : `${inbox.arrived} new notifications`}
          </button>
        </div>
      ) : null}

      {inbox.stale ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm">
          <span className="text-muted-foreground">Some notifications changed. Refresh to see them in order.</span>
          <button
            type="button"
            onClick={() => void inbox.refresh()}
            className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
          >
            <NotificationIcon name="refresh" className="size-3.5" />
            Refresh
          </button>
        </div>
      ) : null}

      {inbox.error ? (
        <p
          role="alert"
          className="flex items-start justify-between gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <span>{inbox.error}</span>
          <button type="button" onClick={inbox.dismissError} className="shrink-0 underline underline-offset-2">
            Dismiss
          </button>
        </p>
      ) : null}

      {/* ── the list ────────────────────────────────────────────────────── */}
      <section
        aria-label="Notification list"
        className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      >
        {page === null ? (
          <ul aria-label="Loading" className="divide-y divide-border">
            {[0, 1, 2, 3, 4].map((key) => (
              <li key={key} className="flex gap-3 px-5 py-4">
                <span className="size-9 shrink-0 animate-pulse rounded-full bg-muted" />
                <span className="flex-1 space-y-2">
                  <span className="block h-3.5 w-2/3 animate-pulse rounded bg-muted" />
                  <span className="block h-3 w-1/2 animate-pulse rounded bg-muted" />
                </span>
              </li>
            ))}
          </ul>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
              <NotificationIcon name={archivedTab ? 'archive' : filters > 0 ? 'search' : 'bell'} className="size-6" />
            </span>
            <h2 className="mt-4 text-base font-semibold">{empty.title}</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">{empty.body}</p>
            {filters > 0 ? (
              <button
                type="button"
                onClick={() => inbox.setFilter({ severity: null, source: null, from: null })}
                className="mt-4 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-border px-4 py-2 sm:px-5">
              <label className="flex items-center gap-2.5 text-xs font-medium text-muted-foreground">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => (allSelected ? inbox.clearSelection() : inbox.selectAll())}
                  className="size-4 accent-primary"
                />
                {selecting ? `${selectedIds.length} selected` : 'Select all on this page'}
              </label>
            </div>
            {groupByDay(items, now).map((group) => (
              <div key={`${group.label}-${group.items[0]?.id ?? ''}`}>
                <h2 className="sticky top-0 z-[1] border-b border-border bg-card/95 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur sm:px-5">
                  {group.label}
                </h2>
                <ul className="divide-y divide-border">
                  {group.items.map((item) => (
                    <InboxRow
                      key={item.id}
                      item={item}
                      now={now}
                      selected={inbox.selected.has(item.id)}
                      selecting={selecting}
                      onToggle={() => inbox.toggle(item.id)}
                      onActivate={activate}
                      onMarkRead={(row) => void inbox.markRead([row.id])}
                      onMarkUnread={(row) => void inbox.markUnread([row.id])}
                      onArchive={(row) => void inbox.archive([row.id])}
                      onUnarchive={(row) => void inbox.unarchive([row.id])}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </section>

      {/* ── pages ───────────────────────────────────────────────────────── */}
      {page && items.length > 0 ? (
        <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {pagerLabel(state.page, state.size, items.length, page.totalCount)}
          </p>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-muted-foreground" htmlFor={`${ids}-size`}>
              Show
              <select
                id={`${ids}-size`}
                value={state.size}
                onChange={(event) => inbox.setFilter({ size: Number(event.target.value) })}
                className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm text-foreground"
              >
                {INBOX_PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <PagerButton
              label="Previous"
              icon="previous"
              disabled={state.page <= 1 || inbox.busy}
              onClick={inbox.previous}
            />
            <PagerButton label="Next" icon="next" disabled={!page.hasNext || inbox.busy} onClick={inbox.next} />
          </div>
        </nav>
      ) : null}

      {/* ── bulk actions, floating while anything is selected ────────────── */}
      {selecting ? (
        <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div
            role="toolbar"
            aria-label="Selected notifications"
            className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-popover p-1.5 pl-4 text-popover-foreground shadow-2xl"
          >
            <span className="mr-2 text-sm font-medium">{selectedIds.length} selected</span>
            {archivedTab ? (
              <BulkButton icon="refresh" label="Move to inbox" onClick={() => void inbox.unarchive(selectedIds)} />
            ) : (
              <>
                <BulkButton icon="check" label="Mark read" onClick={() => void inbox.markRead(selectedIds)} />
                <BulkButton icon="unread" label="Mark unread" onClick={() => void inbox.markUnread(selectedIds)} />
                <BulkButton icon="archive" label="Archive" onClick={() => void inbox.archive(selectedIds)} />
              </>
            )}
            <button
              type="button"
              onClick={inbox.clearSelection}
              aria-label="Clear selection"
              title="Clear selection"
              className="ml-1 grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <NotificationIcon name="close" className="size-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A native select dressed as a pill: accessible as-is, and it looks like a filter chip. */
function PillSelect({
  id,
  label,
  value,
  onChange,
  options,
  active = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  active?: boolean;
}) {
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'h-8 cursor-pointer appearance-none rounded-full border py-0 pl-3 pr-8 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          active
            ? 'border-primary bg-primary/10 font-medium text-primary'
            : 'border-border bg-card text-foreground hover:bg-accent',
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <NotificationIcon
        name="next"
        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 rotate-90 text-muted-foreground"
      />
    </div>
  );
}

function BulkButton({
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
      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <NotificationIcon name={icon} className="size-4" />
      {label}
    </button>
  );
}

function PagerButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: 'Previous' | 'Next';
  icon: 'previous' | 'next';
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {icon === 'previous' ? <NotificationIcon name="previous" className="size-4" /> : null}
      {label}
      {icon === 'next' ? <NotificationIcon name="next" className="size-4" /> : null}
    </button>
  );
}
