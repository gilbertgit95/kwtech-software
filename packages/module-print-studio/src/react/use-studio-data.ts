'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface StudioData<T> {
  /** Null until the first answer. */
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * One read. The booking app's hook, copied structurally, WITHOUT its
 * subscription: the studio is not live (PRINT-STUDIO-PLAN §7), so a shared
 * layout somebody else changed shows when the section is opened again.
 *
 * `load` changes whenever what it reads changes, and the read runs again then.
 * An answer that arrives after a newer read started is dropped.
 *
 * No client cache and no optimistic change: after every act, read again.
 */
export function useStudioData<T>(load: () => Promise<T>, fallback: string): StudioData<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);

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
    // Leaving, or a new `load`: whatever is still in flight answers nobody.
    return () => {
      generation.current += 1;
    };
  }, [reload]);

  return { data, error, loading, reload };
}

/**
 * Running one act at a time: the in-flight guard against a double press, the
 * API's own sentence when it is refused, and whether it went through — so the
 * caller reads again, and closes its dialog, only on success.
 */
export function useStudioAction(fallback: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const run = useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        await action();
        return true;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : fallback);
        return false;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [fallback],
  );

  const dismissError = useCallback(() => setError(null), []);
  return { busy, error, run, dismissError };
}
