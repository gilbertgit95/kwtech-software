'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobHistoryEntryView, JobsClient } from './jobs-client.js';

export interface JobHistoryState {
  entries: JobHistoryEntryView[];
  loading: boolean;
  error: string | null;
  /** Whether older entries exist beyond those shown. */
  hasMore: boolean;
  loadMore: () => void;
}

/**
 * One process's history, a page at a time.
 *
 * `signature` is anything that changes when the history has — the process's
 * last run, its pause, its schedule (`historySignature`). When it changes the
 * list starts again from the newest page, so a run that just finished appears
 * without the page being asked; while it stays the same, the timer that
 * re-reads the processes costs the history nothing.
 */
export function useJobHistory(client: JobsClient, processKey: string, signature: string): JobHistoryState {
  const [entries, setEntries] = useState<JobHistoryEntryView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which read is current: a slow page for a process since closed must not land on the one now open.
  const generation = useRef(0);

  const read = useCallback(
    async (from: string | null, mine: number) => {
      setLoading(true);
      try {
        const page = await client.history(processKey, from);
        if (generation.current !== mine) return;
        setEntries((shown) => (from === null ? page.entries : [...shown, ...page.entries]));
        setCursor(page.nextCursor);
        setError(null);
      } catch (caught) {
        if (generation.current !== mine) return;
        setError(caught instanceof Error ? caught.message : 'Could not load the history.');
      } finally {
        if (generation.current === mine) setLoading(false);
      }
    },
    [client, processKey],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `signature` is the trigger, not an input — a new one means "the history changed, read it again".
  useEffect(() => {
    generation.current += 1;
    void read(null, generation.current);
    return () => {
      generation.current += 1;
    };
  }, [read, signature]);

  const loadMore = useCallback(() => {
    if (cursor === null || loading) return;
    void read(cursor, generation.current);
  }, [read, cursor, loading]);

  return { entries, loading, error, hasMore: cursor !== null, loadMore };
}
