'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createLocalNetworkClient, type LocalNetworkAnswer, type LocalNetworkClient } from './local-network-client.js';

export interface LocalNetworkState {
  answer: LocalNetworkAnswer | null;
  error: string | null;
  busy: boolean;
  reload: () => Promise<void>;
  dismissError: () => void;
}

/**
 * The page's one data hook (frontend rules), without a `run`: the page reads
 * and changes nothing (decision L10). No cache: every load and every Check
 * again asks the API, which reads the certificate file afresh.
 */
export function useLocalNetwork(options: { client?: LocalNetworkClient } = {}): LocalNetworkState {
  const client = useMemo(() => options.client ?? createLocalNetworkClient(), [options.client]);
  const [answer, setAnswer] = useState<LocalNetworkAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setAnswer(await client.view());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the local network setup.');
    } finally {
      setBusy(false);
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    client
      .view()
      .then((loaded) => {
        if (!cancelled) setAnswer(loaded);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the local network setup.');
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const dismissError = useCallback(() => setError(null), []);
  return { answer, error, busy, reload, dismissError };
}
