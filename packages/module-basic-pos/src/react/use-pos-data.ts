'use client';

import { useRealtime } from '@kwtech/module-kit/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { POS_OPERATIONS } from '../operations.js';
import type { PosEventView, PosScopeView } from './pos-client.js';

/** How long after the last event a section reads again — a burst of events is one read. */
const REREAD_DEBOUNCE_MS = 250;

/** Which `posEvents` kinds a section listens for. `sync` (a reconnect) always reloads. */
export type PosEventKind = 'catalogue' | 'customers' | 'settings' | 'order';

export interface PosData<T> {
  /** Null until the first answer. */
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * One read for a management section (Orders, Items, Customers, Settings),
 * kept fresh by `posEvents` the way the till is: another till selling, or an
 * admin renaming an item elsewhere, shows here without a reload.
 *
 * `load` changes whenever what it reads changes (a tab, a search), and the
 * read runs again then. An answer that arrives after a newer read started is
 * dropped, so a slow first tab never overwrites the tab now open.
 */
export function usePosData<T>(
  scope: PosScopeView,
  load: () => Promise<T>,
  kinds: readonly PosEventKind[],
  fallback: string,
): PosData<T> {
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

  // The kinds as one string, so a new array literal each render does not resubscribe.
  const kindList = kinds.join(',');
  useEffect(() => {
    if (!realtime) return;
    const wanted = new Set(kindList.split(','));
    const unsubscribe = realtime.subscribe<{ posEvents: PosEventView }>(
      POS_OPERATIONS.posEvents,
      (event) => {
        if (event.posEvents.kind !== 'sync' && !wanted.has(event.posEvents.kind)) return;
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
  }, [realtime, scope, kindList, reload]);

  return { data, error, loading, reload };
}
