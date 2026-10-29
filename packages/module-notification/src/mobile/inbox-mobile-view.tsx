'use client';

import { cn } from '@kwtech/web-ui/react';
import { useEffect, useState } from 'react';
import { NotificationIcon } from '../react/components/notification-icons.js';
import type { NotificationView } from '../react/notification-client.js';
import { useRegisterNotificationsPage } from '../react/notification-surface.js';
import { useNotificationInbox } from '../react/use-notification-inbox.js';
import { activeFilterCount, emptyInboxCopy, groupByDay, type InboxTab, pagerLabel } from '../react/view/inbox-view.js';
import { severityLook } from '../react/view/severity-view.js';
import { NOTIFICATION_SEVERITIES } from '../types.js';
import { FilterSheet, type FilterSheetGroup } from './filter-sheet.js';
import { MobileInboxRow } from './mobile-inbox-row.js';

const TABS: ReadonlyArray<{ tab: InboxTab; label: string }> = [
  { tab: 'all', label: 'All' },
  { tab: 'unread', label: 'Unread' },
  { tab: 'archived', label: 'Archived' },
];

/**
 * The notification inbox on the phone's bottom bar (issue #22), laid out FOR
 * a phone rather than the full page squeezed into one (reported by the
 * operator, 2026-10-29: four filter menus in a row, a desktop heading, and
 * row tools that appear only on hover).
 *
 * The same `useNotificationInbox` as the full page — the same requests, the
 * same reading of unread, the same live updates — arranged for a thumb:
 *
 *   - All / Unread / Archived as one full-width switch;
 *   - every filter behind ONE "Filters" button, in a sheet from the bottom,
 *     its count on the button so a filtered list never looks like an empty one;
 *   - rows with their tools always reachable (there is no hover on a phone),
 *     and no bulk selection — "Mark all read" covers what people do in bulk;
 *   - a small pager at the foot.
 *
 * ⚠ `syncAddress: false`. The phone frame owns this page's address (its own
 * `?tab=`); the filters are kept in memory instead, for as long as the tab is
 * mounted — and the frame keeps it mounted.
 */
export function InboxMobileView() {
  useRegisterNotificationsPage();
  const inbox = useNotificationInbox({ syncAddress: false });
  const { state, page } = inbox;
  const [now, setNow] = useState(() => new Date());
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const items = page?.items ?? [];
  const unread = page?.unreadCount ?? 0;
  const archivedTab = state.tab === 'archived';
  const filters = activeFilterCount(state);
  const empty = emptyInboxCopy(state);

  const activate = (item: NotificationView) => {
    if (item.readAt === null) void inbox.markRead([item.id]);
  };

  const groups: FilterSheetGroup[] = [
    {
      key: 'order',
      label: 'Order',
      value: state.order,
      options: [
        { value: 'unread_first', label: 'Unread first' },
        { value: 'newest', label: 'Newest first' },
      ],
      onChange: (value) => inbox.setFilter({ order: value === 'newest' ? 'newest' : 'unread_first' }),
    },
    {
      key: 'type',
      label: 'Type',
      value: state.severity ?? '',
      options: [
        { value: '', label: 'All types' },
        ...NOTIFICATION_SEVERITIES.map((severity) => ({ value: severity, label: severityLook(severity).label })),
      ],
      onChange: (value) => inbox.setFilter({ severity: value || null }),
    },
    ...(inbox.sources.length > 1
      ? [
          {
            key: 'source',
            label: 'Source',
            value: state.source ?? '',
            options: [
              { value: '', label: 'All sources' },
              ...inbox.sources.map((source) => ({ value: source.key, label: source.label })),
            ],
            onChange: (value: string) => inbox.setFilter({ source: value || null }),
          },
        ]
      : []),
    {
      key: 'from',
      label: 'From',
      value: state.from ?? '',
      options: [
        { value: '', label: 'Everywhere' },
        { value: 'global', label: 'Platform-wide' },
        ...inbox.organizations.map((org) => ({ value: org.id, label: org.label })),
      ],
      onChange: (value) => inbox.setFilter({ from: value || null }),
    },
  ];
  const clearFilters = () => inbox.setFilter({ severity: null, source: null, from: null });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-lg space-y-4 px-4 pt-5 pb-10">
        {/* ── heading ─────────────────────────────────────────────────── */}
        <header className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight text-foreground">Inbox</h1>
            <p className="mt-0.5 text-sm text-muted-foreground" aria-live="polite">
              {page === null
                ? 'Loading…'
                : unread === 0
                  ? 'You’re all caught up'
                  : `${unread.toLocaleString('en-US')} unread`}
            </p>
          </div>
          {unread > 0 && !archivedTab ? (
            <button
              type="button"
              onClick={() => void inbox.markAllRead()}
              className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full bg-muted px-3.5 text-sm font-medium text-foreground transition-colors active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <NotificationIcon name="check-all" className="size-4" />
              Mark all read
            </button>
          ) : null}
        </header>

        {/* ── which list, and the filters ─────────────────────────────── */}
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Show" className="grid flex-1 grid-cols-3 gap-1 rounded-xl bg-muted p-1">
            {TABS.map(({ tab, label }) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={state.tab === tab}
                onClick={() => inbox.setFilter({ tab })}
                className={cn(
                  'inline-flex min-h-9 items-center justify-center gap-1 rounded-lg text-sm font-medium transition-all',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  state.tab === tab ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
                )}
              >
                {label}
                {tab === 'unread' && unread > 0 ? (
                  <span className="rounded-full bg-primary px-1.5 text-[0.625rem] font-semibold leading-4 text-primary-foreground">
                    {unread > 99 ? '99+' : unread}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-label={filters > 0 ? `Filters, ${filters} on` : 'Filters'}
            className={cn(
              'relative grid size-11 shrink-0 place-items-center rounded-xl transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              filters > 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground active:bg-accent',
            )}
          >
            <NotificationIcon name="settings" className="size-[1.125rem]" />
            {filters > 0 ? (
              <span
                aria-hidden
                className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full border-2 border-background bg-primary text-[0.625rem] font-semibold text-primary-foreground"
              >
                {filters}
              </span>
            ) : null}
          </button>
        </div>

        {filters > 0 ? (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-primary/8 px-3 py-2 text-sm">
            <span className="text-foreground">
              {filters === 1 ? '1 filter on' : `${filters} filters on`} — some notifications are hidden.
            </span>
            <button type="button" onClick={clearFilters} className="shrink-0 font-medium text-primary">
              Clear
            </button>
          </div>
        ) : null}

        {/* ── notices ─────────────────────────────────────────────────── */}
        {inbox.arrived > 0 ? (
          <div className="sticky top-2 z-10 flex justify-center">
            <button
              type="button"
              onClick={inbox.backToTop}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground shadow-lg"
            >
              <NotificationIcon name="previous" className="size-4 rotate-90" />
              {inbox.arrived === 1 ? '1 new notification' : `${inbox.arrived} new notifications`}
            </button>
          </div>
        ) : null}

        {inbox.stale ? (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-muted px-3 py-2.5 text-sm">
            <span className="text-muted-foreground">Some notifications changed.</span>
            <button
              type="button"
              onClick={() => void inbox.refresh()}
              className="inline-flex shrink-0 items-center gap-1 font-medium text-primary"
            >
              <NotificationIcon name="refresh" className="size-3.5" />
              Refresh
            </button>
          </div>
        ) : null}

        {inbox.error ? (
          <p
            role="alert"
            className="flex items-start justify-between gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            <span>{inbox.error}</span>
            <button type="button" onClick={inbox.dismissError} className="shrink-0 underline underline-offset-2">
              Dismiss
            </button>
          </p>
        ) : null}

        {/* ── the list ────────────────────────────────────────────────── */}
        {page === null ? (
          <ul aria-label="Loading" className="space-y-2">
            {[0, 1, 2, 3].map((key) => (
              <li key={key} className="flex gap-3 rounded-2xl border border-border/70 bg-card p-4">
                <span className="size-10 shrink-0 animate-pulse rounded-full bg-muted" />
                <span className="flex-1 space-y-2">
                  <span className="block h-3.5 w-2/3 animate-pulse rounded bg-muted" />
                  <span className="block h-3 w-1/2 animate-pulse rounded bg-muted" />
                </span>
              </li>
            ))}
          </ul>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center rounded-3xl border border-border/70 bg-card px-6 py-12 text-center shadow-sm">
            <span className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <NotificationIcon name={archivedTab ? 'archive' : filters > 0 ? 'search' : 'bell'} className="size-6" />
            </span>
            <h2 className="mt-4 text-base font-semibold text-foreground">{empty.title}</h2>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">{empty.body}</p>
            {filters > 0 ? (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-5 inline-flex min-h-10 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-5">
            {groupByDay(items, now).map((group) => (
              <section key={`${group.label}-${group.items[0]?.id ?? ''}`} aria-label={group.label}>
                <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </h2>
                <ul className="space-y-2">
                  {group.items.map((item) => (
                    <MobileInboxRow
                      key={item.id}
                      item={item}
                      now={now}
                      onActivate={activate}
                      onMarkRead={(row) => void inbox.markRead([row.id])}
                      onMarkUnread={(row) => void inbox.markUnread([row.id])}
                      onArchive={(row) => void inbox.archive([row.id])}
                      onUnarchive={(row) => void inbox.unarchive([row.id])}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {/* ── pages ───────────────────────────────────────────────────── */}
        {page && items.length > 0 && (state.page > 1 || page.hasNext) ? (
          <nav aria-label="Pagination" className="flex items-center justify-between gap-3 pt-1">
            <PagerButton
              label="Newer"
              icon="previous"
              disabled={state.page <= 1 || inbox.busy}
              onClick={inbox.previous}
            />
            <p className="text-center text-xs text-muted-foreground" aria-live="polite">
              {pagerLabel(state.page, state.size, items.length, page.totalCount)}
            </p>
            <PagerButton label="Older" icon="next" disabled={!page.hasNext || inbox.busy} onClick={inbox.next} />
          </nav>
        ) : null}
      </div>

      <FilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        groups={groups}
        active={filters}
        onClear={clearFilters}
      />
    </div>
  );
}

function PagerButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: 'previous' | 'next';
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-10 items-center gap-1 rounded-full bg-muted px-4 text-sm font-medium text-foreground transition-colors active:bg-accent disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {icon === 'previous' ? <NotificationIcon name="previous" className="size-4" /> : null}
      {label}
      {icon === 'next' ? <NotificationIcon name="next" className="size-4" /> : null}
    </button>
  );
}
