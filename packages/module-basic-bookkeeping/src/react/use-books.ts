'use client';

import { useRealtime } from '@kwtech/module-kit/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BOOKS_OPERATIONS } from '../operations.js';
import { type BooksClient, type BooksEventView, type BooksScopeView, createBooksClient } from './books-client.js';

/** How long after the last event a screen reads again — a burst of events is one read. */
const REREAD_DEBOUNCE_MS = 200;

export interface BooksData<T> {
  /** Null until the first answer. */
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * One read, kept fresh by `booksEvents`: somebody recording a payout elsewhere
 * shows here without a reload. Every event reloads — the overview's balances
 * are added up from every entry, so any entry changes all of them.
 *
 * `load` changes whenever what it reads changes (a month, an investor), and the
 * read runs again then. An answer that arrives after a newer read started is
 * dropped, so a slow first month never overwrites the month now open.
 */
export function useBooksData<T>(scope: BooksScopeView, load: () => Promise<T>, fallback: string): BooksData<T> {
  const realtime = useRealtime();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    generation.current += 1;
    const mine = generation.current;
    setLoading(true);
    try {
      const answer = await load();
      if (mine !== generation.current) return;
      setData(answer);
      setError(null);
    } catch (caught) {
      if (mine !== generation.current) return;
      setError(caught instanceof Error ? caught.message : fallback);
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [load, fallback]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!realtime) return;
    const unsubscribe = realtime.subscribe<{ booksEvents: BooksEventView }>(
      BOOKS_OPERATIONS.booksEvents,
      () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          void reload();
        }, REREAD_DEBOUNCE_MS);
      },
      { organizationId: scope.organizationId, workspaceId: scope.workspaceId },
    );
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [realtime, scope, reload]);

  return { data, error, loading, reload };
}

/** What every section of the app shares: who and where, the client, and whether it is live. */
export interface BooksContext {
  scope: BooksScopeView;
  client: BooksClient;
  live: boolean;
}

export function useBooksContext(
  organizationId: string,
  workspaceId: string,
  options: { client?: BooksClient | undefined } = {},
): BooksContext {
  const live = useRealtime() !== null;
  const scope = useMemo(() => ({ organizationId, workspaceId }), [organizationId, workspaceId]);
  const injected = options.client;
  const client = useMemo(() => injected ?? createBooksClient(), [injected]);
  return { scope, client, live };
}

/**
 * Runs one write: guards a double press (`busy`), keeps the API's sentence on
 * failure, and says whether it went through. No optimistic UI: the screen
 * re-reads when the books' event arrives, or the caller reloads.
 */
export function useBooksAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const run = useCallback(async <T>(action: () => Promise<T>, fallback: string): Promise<T | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
      return null;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);
  const dismissError = useCallback(() => setError(null), []);
  return { busy, error, run, dismissError, setError };
}
