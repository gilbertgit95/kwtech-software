'use client';

import { useRealtime } from '@kwtech/module-kit/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NOTIFICATION_OPERATIONS } from '../operations.js';
import {
  createNotificationClient,
  type NotificationClient,
  type NotificationEventView,
  type NotificationPageView,
  type NotificationSourceView,
  type NotificationView,
} from './notification-client.js';
import {
  DEFAULT_INBOX_STATE,
  type InboxState,
  inboxRequest,
  mergeLive,
  newestOccurredAt,
  organizationsIn,
  parseInboxState,
  serializeInboxState,
  withFilter,
} from './view/inbox-view.js';

export interface NotificationInboxState {
  state: InboxState;
  page: NotificationPageView | null;
  sources: NotificationSourceView[];
  organizations: Array<{ id: string; label: string }>;
  error: string | null;
  busy: boolean;
  /** Something changed elsewhere; "Refresh" re-reads without moving the page. */
  stale: boolean;
  /** New notifications that arrived while this was not page 1. */
  arrived: number;
  selected: ReadonlySet<string>;
  toggle(id: string): void;
  selectAll(): void;
  clearSelection(): void;
  setFilter(change: Partial<Omit<InboxState, 'page' | 'after' | 'before'>>): void;
  next(): void;
  previous(): void;
  backToTop(): void;
  refresh(): Promise<void>;
  markRead(ids: readonly string[]): Promise<void>;
  markUnread(ids: readonly string[]): Promise<void>;
  archive(ids: readonly string[]): Promise<void>;
  unarchive(ids: readonly string[]): Promise<void>;
  /** Every unread notification up to the newest one on screen — never one that arrived after. */
  markAllRead(): Promise<void>;
  dismissError(): void;
}

/**
 * The full inbox: one page at a time, its state in the URL, and live.
 *
 * ## ⚠ Rows do not move under the reader
 *
 * Marking read (by opening, or in bulk) RESTYLES a row where it is. It moves to
 * the read section only on the next fetch — a page turn, a filter, or Refresh.
 * A list that re-sorted while someone clicked through it would move the next
 * row out from under the pointer. Archiving is the exception: an archived row
 * leaves the inbox, which is what the person asked for.
 *
 * ## Live
 *
 * Page 1 takes new notifications as they arrive. Any other page shows "N new —
 * back to top" instead of inserting rows, for the same reason. A RECALL removes
 * its rows at once on any page: a recall is a promise that the words are gone.
 */
export function useNotificationInbox(options: { client?: NotificationClient } = {}): NotificationInboxState {
  const client = useMemo(() => options.client ?? createNotificationClient(), [options.client]);
  const realtime = useRealtime();

  const [state, setState] = useState<InboxState>(DEFAULT_INBOX_STATE);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<NotificationPageView | null>(null);
  const [sources, setSources] = useState<NotificationSourceView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [arrived, setArrived] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const seenOrganizations = useRef(new Map<string, string>());
  const [organizations, setOrganizations] = useState<Array<{ id: string; label: string }>>([]);

  // ── the URL is the state ────────────────────────────────────────────────
  useEffect(() => {
    setState(parseInboxState(window.location.search));
    setReady(true);
    const onPop = () => setState(parseInboxState(window.location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = useCallback((next: InboxState) => {
    // pushState, not `next/navigation`: modules never import Next. Back works
    // because `popstate` above reads the URL again.
    window.history.pushState(null, '', `${window.location.pathname}${serializeInboxState(next)}`);
    setState(next);
  }, []);

  const load = useCallback(
    async (current: InboxState) => {
      setBusy(true);
      try {
        const result = await client.list(inboxRequest(current));
        setPage(result);
        setSelected(new Set());
        setStale(false);
        if (current.page === 1 && !current.after && !current.before) setArrived(0);
        for (const org of organizationsIn(result.items)) {
          if (!seenOrganizations.current.has(org.id)) seenOrganizations.current.set(org.id, org.label);
        }
        setOrganizations([...seenOrganizations.current].map(([id, label]) => ({ id, label })));
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load your notifications.');
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  useEffect(() => {
    if (!ready) return;
    void load(state);
  }, [ready, state, load]);

  useEffect(() => {
    let cancelled = false;
    client
      .sources()
      .then((list) => {
        if (!cancelled) setSources(list);
      })
      .catch(() => {
        // The source filter is optional; without the list it simply is not offered.
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // ── live ────────────────────────────────────────────────────────────────
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (!realtime) return;
    let syncedOnce = false;
    return realtime.subscribe<{ notificationEvents: NotificationEventView }>(
      NOTIFICATION_OPERATIONS.notificationEvents,
      ({ notificationEvents: event }) => {
        const current = stateRef.current;
        const onFirstPage = current.page === 1 && !current.after && !current.before;
        switch (event.kind) {
          case 'sync':
            // The first is this subscription opening; a later one is a reconnect.
            if (syncedOnce && onFirstPage) void load(current);
            else if (syncedOnce) setStale(true);
            syncedOnce = true;
            return;
          case 'created':
          case 'grouped': {
            const item = event.notification;
            if (!item || !matches(item, current)) return;
            if (!onFirstPage) {
              setArrived((count) => count + 1);
              return;
            }
            setPage((existing) =>
              existing
                ? {
                    ...existing,
                    items: mergeLive(existing.items, item).slice(0, current.size),
                    totalCount: existing.totalCount + (event.kind === 'created' ? 1 : 0),
                    unreadCount: existing.unreadCount + (event.kind === 'created' ? 1 : 0),
                  }
                : existing,
            );
            return;
          }
          case 'recalled':
            setPage((existing) =>
              existing
                ? { ...existing, items: existing.items.filter((item) => !event.ids.includes(item.id)) }
                : existing,
            );
            return;
          default:
            // Read, unread or archived in ANOTHER tab: offer Refresh rather than
            // moving rows under this one.
            setStale(true);
        }
      },
    );
  }, [realtime, load]);

  // ── actions ─────────────────────────────────────────────────────────────
  const patchItems = (ids: readonly string[], change: (item: NotificationView) => NotificationView | null) => {
    const set = new Set(ids);
    setPage((existing) => {
      if (!existing) return existing;
      const items: NotificationView[] = [];
      for (const item of existing.items) {
        if (!set.has(item.id)) {
          items.push(item);
          continue;
        }
        const next = change(item);
        if (next) items.push(next);
      }
      return { ...existing, items };
    });
  };

  const run = useCallback(async (work: () => Promise<unknown>, fallback: string) => {
    try {
      await work();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
      return false;
    }
  }, []);

  const markRead = async (ids: readonly string[]) => {
    if (ids.length === 0) return;
    if (!(await run(() => client.markRead(ids), 'Could not mark them read.'))) return;
    const at = new Date().toISOString();
    patchItems(ids, (item) => ({ ...item, readAt: item.readAt ?? at }));
    setStale(true);
    setSelected(new Set());
  };
  const markUnread = async (ids: readonly string[]) => {
    if (ids.length === 0) return;
    if (!(await run(() => client.markUnread(ids), 'Could not mark them unread.'))) return;
    patchItems(ids, (item) => ({ ...item, readAt: null }));
    setStale(true);
    setSelected(new Set());
  };
  const archive = async (ids: readonly string[]) => {
    if (ids.length === 0) return;
    if (!(await run(() => client.archive(ids), 'Could not archive them.'))) return;
    patchItems(ids, () => null);
    setSelected(new Set());
  };
  const markAllRead = async () => {
    // Bounded by the newest row this page has SEEN, so a notification that
    // lands while the button is being pressed stays unread.
    const before = newestOccurredAt(page?.items ?? []) ?? new Date().toISOString();
    if (!(await run(() => client.markAllRead(before), 'Could not mark them read.'))) return;
    await load(state);
  };
  const unarchive = async (ids: readonly string[]) => {
    if (ids.length === 0) return;
    if (!(await run(() => client.unarchive(ids), 'Could not move them back.'))) return;
    patchItems(ids, () => null);
    setSelected(new Set());
  };

  return {
    state,
    page,
    sources,
    organizations,
    error,
    busy,
    stale,
    arrived,
    selected,
    toggle: (id) =>
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    selectAll: () => setSelected(new Set(page?.items.map((item) => item.id) ?? [])),
    clearSelection: () => setSelected(new Set()),
    setFilter: (change) => go(withFilter(state, change)),
    next: () => {
      if (!page?.hasNext || !page.endCursor) return;
      go({ ...state, page: state.page + 1, after: page.endCursor, before: null });
    },
    previous: () => {
      if (state.page <= 1 || !page?.startCursor) return;
      // Page 2 → 1 goes to the TOP rather than "before the first row": page 1
      // is then exactly what a fresh visit shows, new arrivals included.
      if (state.page === 2) {
        go(withFilter(state, {}));
        return;
      }
      go({ ...state, page: state.page - 1, before: page.startCursor, after: null });
    },
    backToTop: () => go(withFilter(state, {})),
    refresh: () => load(state),
    markRead,
    markUnread,
    archive,
    unarchive,
    markAllRead,
    dismissError: () => setError(null),
  };
}

/** Whether a live notification belongs in the list as filtered. */
function matches(item: NotificationView, state: InboxState): boolean {
  if (state.tab === 'archived') return false;
  if (state.severity && item.severity !== state.severity) return false;
  if (state.source && item.source !== state.source) return false;
  if (state.from === 'global' && item.organizationId !== null) return false;
  if (state.from && state.from !== 'global' && item.organizationId !== state.from) return false;
  return true;
}
