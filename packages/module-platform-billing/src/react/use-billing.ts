'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type BillingClient,
  type BillingHistoryFilter,
  type BillingHistoryPageView,
  type BillingOverviewView,
  createBillingClient,
} from './billing-client.js';

export interface BillingState {
  overview: BillingOverviewView | null;
  history: BillingHistoryPageView | null;
  /** Why the history could not be read; the rest of the page still works. */
  historyError: string | null;
  /** The history's filters, and changing them (the first page is read again). */
  filter: BillingHistoryFilter;
  setFilter: (filter: BillingHistoryFilter) => void;
  error: string | null;
  /** Something the person did worked: said in a `role="status"` line. */
  notice: string | null;
  busy: boolean;
  /** Reads the page again; answers whether it worked. */
  reload: () => Promise<boolean>;
  /** Runs one act at a time and re-reads after it, whatever happened. Returns whether it succeeded. */
  run: (action: (client: BillingClient) => Promise<unknown>, done?: string) => Promise<boolean>;
  /** The next page of the history. */
  loadMore: () => Promise<void>;
  dismissError: () => void;
  client: BillingClient;
}

/**
 * The Billing page's one data hook (frontend rules): no cache and no
 * optimistic state; after every act the overview and the first page of the
 * history are read again, so the page always shows what the server holds.
 */
export function useBilling(organizationId: string, options: { client?: BillingClient } = {}): BillingState {
  const client = useMemo(() => options.client ?? createBillingClient(), [options.client]);
  const [overview, setOverview] = useState<BillingOverviewView | null>(null);
  const [history, setHistory] = useState<BillingHistoryPageView | null>(null);
  /** The history's own failure: said in its section with a retry, never hiding the status and its buttons. */
  const [historyError, setHistoryError] = useState<string | null>(null);
  /** The history's filters (year, state, hide what changed nothing): the first page is read again when they change. */
  const [filter, setFilter] = useState<BillingHistoryFilter>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  /**
   * Bumped whenever the history is replaced by a fresh first page: a page of
   * older requests that comes back after it belongs to the list before, and
   * appending it would skip what lies between.
   */
  const generation = useRef(0);

  /**
   * Reads the overview and the first page of the history, EACH ON ITS OWN:
   * a history that cannot be read never hides the status and the buttons
   * that renew. Answers whether the overview was read, so an act that
   * succeeded is never reported as failed.
   */
  const readAll = useCallback(
    async (isCancelled: () => boolean = () => false): Promise<boolean> => {
      const [nextOverview, nextHistory] = await Promise.allSettled([
        client.overview(organizationId),
        client.history(organizationId, null, filter),
      ]);
      if (isCancelled()) return false;
      if (nextHistory.status === 'fulfilled') {
        generation.current += 1;
        setHistory(nextHistory.value);
        setHistoryError(null);
      } else {
        setHistoryError(sentence(nextHistory.reason, 'Could not load the history.'));
      }
      if (nextOverview.status === 'fulfilled') {
        setOverview(nextOverview.value);
        return true;
      }
      setError(sentence(nextOverview.reason, 'Could not load billing.'));
      return false;
    },
    [client, organizationId, filter],
  );

  const reload = useCallback(() => readAll(), [readAll]);

  useEffect(() => {
    let cancelled = false;
    void readAll(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [readAll]);

  const run = useCallback(
    async (action: (client: BillingClient) => Promise<unknown>, done?: string) => {
      // One at a time: a second press while the first is in flight does nothing.
      if (inFlight.current) return false;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      setNotice(null);
      let acted = false;
      try {
        await action(client);
        acted = true;
        if (done) setNotice(done);
        // ⚠ The act is done whatever the re-read says: a failed re-read is said as such, with Reload beside it.
        if (!(await reload())) {
          setError('That was saved, but the page could not refresh. Reload to see it.');
        }
        return true;
      } catch (cause) {
        if (acted) return true;
        setError(cause instanceof Error ? cause.message : 'That did not work.');
        await reload();
        return false;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [client, reload],
  );

  /**
   * A new filter starts the history from nothing: the old list (and its
   * totals) never sits under the new controls, a failed read shows its error,
   * and a page of older requests still loading for the old filter is dropped.
   */
  const changeFilter = useCallback((next: BillingHistoryFilter) => {
    generation.current += 1;
    setHistory(null);
    setHistoryError(null);
    setFilter(next);
  }, []);

  const loadingMore = useRef(false);
  const loadMore = useCallback(async () => {
    // One page at a time: two quick presses would read the same cursor and append the page twice.
    if (!history?.nextCursor || loadingMore.current) return;
    loadingMore.current = true;
    const startedIn = generation.current;
    try {
      const next = await client.history(organizationId, history.nextCursor, filter);
      // The history was replaced while this page was loading: it belongs to the old list, so it is dropped.
      if (generation.current !== startedIn) return;
      // Appended to what is shown NOW (a reload may have replaced it meanwhile), without repeating a request.
      setHistory((current) => {
        const shown = current ?? { items: [], nextCursor: null, totals: next.totals };
        const seen = new Set(shown.items.map((item) => item.id));
        return {
          items: [...shown.items, ...next.items.filter((item) => !seen.has(item.id))],
          nextCursor: next.nextCursor,
          totals: next.totals,
        };
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load more of the history.');
    } finally {
      loadingMore.current = false;
    }
  }, [client, organizationId, history, filter]);

  return {
    overview,
    history,
    historyError,
    filter,
    setFilter: changeFilter,
    error,
    notice,
    busy,
    reload,
    run,
    loadMore,
    dismissError: () => setError(null),
    client,
  };
}

/** A failure as the sentence to show. */
function sentence(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
