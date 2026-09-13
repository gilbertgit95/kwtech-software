'use client';

import { useHoldsFeature, useRealtime } from '@kwtech/module-kit/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QUEUE_FEATURE } from '../feature-keys.js';
import { QUEUE_OPERATIONS } from '../operations.js';
import {
  createQueueClient,
  type QueueClient,
  type QueueConsoleView,
  type QueueDisplayCodeView,
  type QueueEventView,
  type QueueScopeView,
} from './queue-client.js';

/** How often the code panel re-reads its display count. Passes are not evented. */
const DISPLAY_COUNT_REFRESH_MS = 15_000;

/** Several events in a burst — a call, and the Done it implied — become one re-read. */
const REREAD_DEBOUNCE_MS = 200;

export interface QueueConsoleState {
  scope: QueueScopeView;
  client: QueueClient;
  view: QueueConsoleView | null;
  /** The display code panel — only for holders of `queue:start`, and only while running. */
  code: QueueDisplayCodeView | null;
  error: string | null;
  busy: boolean;
  /** Whether the app opened a socket. Without one the console updates only when it re-reads. */
  live: boolean;
  reload: () => Promise<void>;
  /**
   * Runs one action, then re-reads.
   *
   * ⚠ ONE AT A TIME. A keyboard shortcut does not respect a disabled button, and
   * two Call nexts fired in one tick are two numbers. Returns whether the action
   * succeeded.
   */
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  dismissError: () => void;
}

/**
 * The console's data: read once, then kept current by the socket.
 *
 * ⚠ EVERY EVENT IS ANSWERED WITH A RE-READ, `sync` included. The screen never
 * applies a call to its own copy of the queue: which window serves what, and
 * what was completed by implication, is the server's arithmetic, and a second
 * implementation of it here is a console that disagrees with the TV.
 */
export function useQueueConsole(
  organizationId: string,
  workspaceId: string,
  options: { client?: QueueClient } = {},
): QueueConsoleState {
  const scope = useMemo(() => ({ organizationId, workspaceId }), [organizationId, workspaceId]);
  const client = useMemo(() => options.client ?? createQueueClient(), [options.client]);
  const realtime = useRealtime();
  const canSeeCode = useHoldsFeature(QUEUE_FEATURE.start);

  const [view, setView] = useState<QueueConsoleView | null>(null);
  const [code, setCode] = useState<QueueDisplayCodeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    try {
      const [next, nextCode] = await Promise.all([
        client.console(scope),
        canSeeCode ? client.displayCode(scope) : Promise.resolve(null),
      ]);
      setView(next);
      setCode(nextCode);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, [client, scope, canSeeCode]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!realtime) return;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = realtime.subscribe<{ queueEvents: QueueEventView }>(
      QUEUE_OPERATIONS.queueEvents,
      () => {
        if (pending) return;
        pending = setTimeout(() => {
          pending = null;
          void reload();
        }, REREAD_DEBOUNCE_MS);
      },
      { organizationId: scope.organizationId, workspaceId: scope.workspaceId },
    );
    return () => {
      unsubscribe();
      if (pending) clearTimeout(pending);
    };
  }, [realtime, reload, scope]);

  // The connected-display count changes when a TV opens, which publishes nothing.
  const running = view?.session != null;
  useEffect(() => {
    if (!canSeeCode || !running) return;
    const timer = setInterval(() => {
      client
        .displayCode(scope)
        .then(setCode)
        .catch(() => undefined);
    }, DISPLAY_COUNT_REFRESH_MS);
    return () => clearInterval(timer);
  }, [canSeeCode, running, client, scope]);

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
        setError((caught as Error).message);
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

  return { scope, client, view, code, error, busy, live: realtime !== null, reload, run, dismissError };
}
