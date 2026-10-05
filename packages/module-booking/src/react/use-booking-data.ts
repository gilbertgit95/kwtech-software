'use client';

import { useRealtime } from '@kwtech/module-kit/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BOOKING_OPERATIONS } from '../operations.js';
import type { BookingEventView, BookingScopeView } from './booking-client.js';

/** How long after the last event a section reads again — a burst of events is one read. */
const REREAD_DEBOUNCE_MS = 200;

/** Which `bookingEvents` kinds a read listens for. `sync` (a reconnect) always reloads. */
export type BookingEventKind = 'appointment' | 'catalogue' | 'settings';

export interface BookingData<T> {
  /** Null until the first answer. */
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * One read, kept fresh by `bookingEvents`: a booking made at another desk, or
 * hours changed in another tab, shows here without a reload. The point of
 * sale's hook, copied structurally.
 *
 * `load` changes whenever what it reads changes (the day, the service), and the
 * read runs again then. An answer that arrives after a newer read started is
 * dropped, so a slow read of yesterday never overwrites today.
 *
 * No client cache and no optimistic change: after every act, read again.
 */
export function useBookingData<T>(
  scope: BookingScopeView,
  load: () => Promise<T>,
  kinds: readonly BookingEventKind[],
  fallback: string,
): BookingData<T> {
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
    // Leaving, or a new `load`: whatever is still in flight answers nobody.
    return () => {
      generation.current += 1;
    };
  }, [reload]);

  // The kinds as one string, so a new array literal each render does not resubscribe.
  const kindList = kinds.join(',');
  useEffect(() => {
    if (!realtime) return;
    const wanted = new Set(kindList.split(','));
    const unsubscribe = realtime.subscribe<{ bookingEvents: BookingEventView }>(
      BOOKING_OPERATIONS.bookingEvents,
      (event) => {
        if (event.bookingEvents.kind !== 'sync' && !wanted.has(event.bookingEvents.kind)) return;
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

/**
 * Running one act at a time: the in-flight guard against a double press, the
 * API's own sentence when it is refused, and whether it went through — so the
 * caller reads again, and closes its dialog, only on success.
 */
export function useBookingAction(fallback: string) {
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
