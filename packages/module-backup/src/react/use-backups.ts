'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type BackupClient, type BackupStateView, createBackupClient } from './backup-client.js';

/** While something is running, the page re-reads this often, so it sees the end of it. */
const BUSY_REREAD_MS = 3000;

export interface BackupsState {
  view: BackupStateView | null;
  error: string | null;
  busy: boolean;
  reload: () => Promise<void>;
  /** Runs one act, one at a time; reloads after. Returns whether it succeeded. */
  run: (action: (client: BackupClient) => Promise<unknown>) => Promise<boolean>;
  dismissError: () => void;
  client: BackupClient;
}

/** The Backups page's one data hook (frontend rules): no cache, re-read after every act. */
export function useBackups(options: { client?: BackupClient } = {}): BackupsState {
  const client = useMemo(() => options.client ?? createBackupClient(), [options.client]);
  const [view, setView] = useState<BackupStateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    try {
      setView(await client.state());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the backups.');
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    client
      .state()
      .then((state) => {
        if (!cancelled) setView(state);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the backups.');
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // A backup started elsewhere (the daily run, another tab) is followed until it ends.
  const running = view !== null && view.activity !== 'idle';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void reload(), BUSY_REREAD_MS);
    return () => clearInterval(timer);
  }, [running, reload]);

  const run = useCallback(
    async (action: (client: BackupClient) => Promise<unknown>) => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        await action(client);
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

  return { view, error, busy, reload, run, dismissError: () => setError(null), client };
}
