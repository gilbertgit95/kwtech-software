'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type BillingClient,
  type BillingHistoryPageView,
  type BillingOverviewView,
  createBillingClient,
} from './billing-client.js';

export interface BillingState {
  overview: BillingOverviewView | null;
  history: BillingHistoryPageView | null;
  error: string | null;
  /** Something the person did worked: said in a `role="status"` line. */
  notice: string | null;
  busy: boolean;
  reload: () => Promise<void>;
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

  const reload = useCallback(async () => {
    try {
      const [nextOverview, nextHistory] = await Promise.all([
        client.overview(organizationId),
        client.history(organizationId, null),
      ]);
      generation.current += 1;
      setOverview(nextOverview);
      setHistory(nextHistory);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load billing.');
    }
  }, [client, organizationId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([client.overview(organizationId), client.history(organizationId, null)])
      .then(([nextOverview, nextHistory]) => {
        if (cancelled) return;
        generation.current += 1;
        setOverview(nextOverview);
        setHistory(nextHistory);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load billing.');
      });
    return () => {
      cancelled = true;
    };
  }, [client, organizationId]);

  const run = useCallback(
    async (action: (client: BillingClient) => Promise<unknown>, done?: string) => {
      // One at a time: a second press while the first is in flight does nothing.
      if (inFlight.current) return false;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await action(client);
        if (done) setNotice(done);
        await reload();
        return true;
      } catch (cause) {
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

  const loadingMore = useRef(false);
  const loadMore = useCallback(async () => {
    // One page at a time: two quick presses would read the same cursor and append the page twice.
    if (!history?.nextCursor || loadingMore.current) return;
    loadingMore.current = true;
    const startedIn = generation.current;
    try {
      const next = await client.history(organizationId, history.nextCursor);
      // The history was replaced while this page was loading: it belongs to the old list, so it is dropped.
      if (generation.current !== startedIn) return;
      // Appended to what is shown NOW (a reload may have replaced it meanwhile), without repeating a request.
      setHistory((current) => {
        const shown = current ?? { items: [], nextCursor: null };
        const seen = new Set(shown.items.map((item) => item.id));
        return {
          items: [...shown.items, ...next.items.filter((item) => !seen.has(item.id))],
          nextCursor: next.nextCursor,
        };
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load more of the history.');
    } finally {
      loadingMore.current = false;
    }
  }, [client, organizationId, history]);

  return {
    overview,
    history,
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
