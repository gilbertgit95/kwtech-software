'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createJobsClient, type JobProcessView, type JobsClient } from './jobs-client.js';

/**
 * How often the page re-reads the processes. Runs start and finish on the
 * server with nobody pressing anything, and this module publishes no events,
 * so the page looks again — often enough that "Running" does not sit there
 * long after the run ended, and seldom enough to cost nothing.
 */
export const JOBS_REFRESH_MS = 10_000;

export interface JobsAdminState {
  client: JobsClient;
  /** Null until the first read lands. */
  processes: JobProcessView[] | null;
  /** When the list was last read successfully, for "Updated 8:47 AM". Null until the first read. */
  loadedAt: Date | null;
  error: string | null;
  busy: boolean;
  reload: () => Promise<void>;
  /**
   * Runs one control action, then re-reads.
   *
   * ⚠ ONE AT A TIME. A double press on Pause must not be two requests: the
   * second would be refused as already paused, and the page would show an
   * error for an action that worked. Returns whether the action succeeded.
   */
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  dismissError: () => void;
}

/**
 * The page's data: read once, re-read after every action, and re-read on a
 * timer while the tab is in front.
 *
 * ⚠ The screen never applies an action to its own copy. Whether a process is
 * queued, where, and what its last run came to is the server's arithmetic; a
 * control answers with the process re-read, and the list is read again anyway.
 */
export function useJobsAdmin(options: { client?: JobsClient } = {}): JobsAdminState {
  const client = useMemo(() => options.client ?? createJobsClient(), [options.client]);
  const [processes, setProcesses] = useState<JobProcessView[] | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    try {
      setProcesses(await client.processes());
      setLoadedAt(new Date());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the background processes.');
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const timer = setInterval(() => {
      // Not behind another tab, and not on top of an action whose own re-read is coming.
      if (document.hidden || inFlight.current) return;
      void reload();
    }, JOBS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setBusy(true);
      try {
        await action();
        setError(null);
        return true;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not do that.');
        return false;
      } finally {
        inFlight.current = false;
        setBusy(false);
        await reload();
      }
    },
    [reload],
  );

  const dismissError = useCallback(() => setError(null), []);

  return { client, processes, loadedAt, error, busy, reload, run, dismissError };
}
