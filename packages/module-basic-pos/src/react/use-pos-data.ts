'use client';

import { useRealtime } from '@kwtech/module-kit/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { POS_OPERATIONS } from '../operations.js';
import type { PosEventView, PosScopeView } from './pos-client.js';
import { onPosWrite } from './pos-local-events.js';

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
 * And kept fresh WITHOUT the socket too (issue #50): a write made elsewhere in
 * this page is heard at once (`pos-local-events.ts`), and coming back to the
 * window reads again, as a reconnect's `sync` does. A section also reads when
 * it opens, so switching POS tabs always shows the store as it is.
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

  /** Reads again soon, once for a burst — from the socket, this page's writes, or the window coming back. */
  const hear = useCallback(
    (event: PosEventView) => {
      if (event.kind !== 'sync' && !kindList.split(',').includes(event.kind)) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void reload();
      }, REREAD_DEBOUNCE_MS);
    },
    [kindList, reload],
  );

  useEffect(() => {
    const stopLocal = onPosWrite(scope, hear);
    const sync = () => hear({ kind: 'sync', orderId: null, actorId: null });
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', sync);
    const unsubscribe = realtime
      ? realtime.subscribe<{ posEvents: PosEventView }>(POS_OPERATIONS.posEvents, (event) => hear(event.posEvents), {
          organizationId: scope.organizationId,
          workspaceId: scope.workspaceId,
        })
      : null;
    return () => {
      stopLocal();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', sync);
      unsubscribe?.();
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [realtime, scope, hear]);

  return { data, error, loading, reload };
}
