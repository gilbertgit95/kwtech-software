'use client';

import { useHoldsFeature, useRealtime } from '@kwtech/module-kit/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { effectiveKeymap, type PosKeymap } from '../domain/keymap.js';
import { POS_CONFLICT_MESSAGE } from '../domain/orders.js';
import { POS_FEATURE } from '../feature-keys.js';
import { POS_OPERATIONS } from '../operations.js';
import {
  createPosClient,
  type PosCatalogueView,
  type PosClient,
  type PosEventView,
  type PosOrderSummaryView,
  type PosOrderView,
  type PosScopeView,
} from './pos-client.js';

/** How long after the last event the till reads again — a burst of events is one read. */
const REREAD_DEBOUNCE_MS = 200;

export interface TillState {
  scope: PosScopeView;
  client: PosClient;
  catalogue: PosCatalogueView | null;
  keymap: PosKeymap;
  timeZone: string;
  /** The order on the till: open, or just finished (its receipt). Null for a clear till. */
  order: PosOrderView | null;
  /** Held orders waiting (D8), oldest first. */
  pending: PosOrderSummaryView[];
  canSell: boolean;
  canDiscount: boolean;
  canRefund: boolean;
  live: boolean;
  error: string | null;
  dismissError: () => void;
  /** Shows a failure from outside `act` (saving a customer first) in the till's one alert. */
  showError: (caught: unknown, fallback: string) => void;
  busy: boolean;
  /**
   * Runs one act on the order — one at a time, a double click is one request —
   * and puts the order it answers with on the till. `act` gets the order to
   * act on, created first if the till is clear and `create` is set.
   */
  act: (
    fn: (order: PosOrderView) => Promise<PosOrderView>,
    options?: { create?: boolean },
  ) => Promise<PosOrderView | null>;
  /** Clears the till for the next customer. A held order stays in Pending. */
  clear: () => void;
  /** Puts a pending (or any) order on the till. */
  resume: (orderId: string) => Promise<void>;
  reloadPending: () => Promise<void>;
}

/**
 * The till's one data hook (frontend rules): the catalogue it searches in the
 * browser (D19), the store's keymap and time zone, the order on the till, and
 * the pending list — kept fresh by `posEvents`.
 *
 * No optimistic UI: every act's answer IS the order as the server now holds it
 * (`computeOrderTotals` ran there), and the till shows exactly that.
 */
export function useTill(organizationId: string, workspaceId: string, options: { client?: PosClient } = {}): TillState {
  const scope = useMemo(() => ({ organizationId, workspaceId }), [organizationId, workspaceId]);
  const client = useMemo(() => options.client ?? createPosClient(), [options.client]);
  const realtime = useRealtime();
  const canSell = useHoldsFeature(POS_FEATURE.sell);
  const canDiscount = useHoldsFeature(POS_FEATURE.discount);
  const canRefund = useHoldsFeature(POS_FEATURE.refund);

  const [catalogue, setCatalogue] = useState<PosCatalogueView | null>(null);
  const [keymap, setKeymap] = useState<PosKeymap>(effectiveKeymap(null));
  const [timeZone, setTimeZone] = useState('Asia/Manila');
  const [order, setOrder] = useState<PosOrderView | null>(null);
  const [pending, setPending] = useState<PosOrderSummaryView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The events handler reads the current order through this, so it is installed once.
  const orderRef = useRef<PosOrderView | null>(null);
  orderRef.current = order;

  const fail = useCallback((caught: unknown, fallback: string) => {
    setError(caught instanceof Error ? caught.message : fallback);
  }, []);

  // ── reading ───────────────────────────────────────────────────────────────

  const loadCatalogue = useCallback(async () => {
    try {
      setCatalogue(await client.catalogue(scope));
    } catch (caught) {
      fail(caught, 'Could not load the items.');
    }
  }, [client, scope, fail]);

  const loadSettings = useCallback(async () => {
    try {
      const settings = await client.settings(scope);
      setTimeZone(settings.timeZone);
      setKeymap(effectiveKeymap(JSON.parse(settings.keymap) as Partial<PosKeymap>));
    } catch {
      // The defaults serve: a till without the store's keymap still sells.
    }
  }, [client, scope]);

  const reloadPending = useCallback(async () => {
    try {
      setPending(await client.orders(scope, 'pending'));
    } catch (caught) {
      fail(caught, 'Could not load the pending orders.');
    }
  }, [client, scope, fail]);

  const reloadOrder = useCallback(async () => {
    const current = orderRef.current;
    if (!current) return;
    try {
      setOrder(await client.order(scope, current.id));
    } catch (caught) {
      fail(caught, 'Could not reload this order.');
    }
  }, [client, scope, fail]);

  useEffect(() => {
    void loadCatalogue();
    void loadSettings();
    void reloadPending();
  }, [loadCatalogue, loadSettings, reloadPending]);

  // ── live ──────────────────────────────────────────────────────────────────

  const kinds = useRef(new Set<string>());
  const onEvent = useCallback(
    (event: PosEventView) => {
      kinds.current.add(event.kind === 'order' && event.orderId === orderRef.current?.id ? 'current' : event.kind);
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        const seen = kinds.current;
        kinds.current = new Set();
        const all = seen.has('sync');
        if (all || seen.has('catalogue')) void loadCatalogue();
        if (all || seen.has('settings')) void loadSettings();
        if (all || seen.has('order') || seen.has('current')) void reloadPending();
        if (all || seen.has('current')) void reloadOrder();
      }, REREAD_DEBOUNCE_MS);
    },
    [loadCatalogue, loadSettings, reloadPending, reloadOrder],
  );

  useEffect(() => {
    if (!realtime) return;
    const unsubscribe = realtime.subscribe<{ posEvents: PosEventView }>(
      POS_OPERATIONS.posEvents,
      (data) => onEvent(data.posEvents),
      { organizationId: scope.organizationId, workspaceId: scope.workspaceId },
    );
    return () => {
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [realtime, scope, onEvent]);

  // ── acts ──────────────────────────────────────────────────────────────────

  const act = useCallback(
    async (
      fn: (order: PosOrderView) => Promise<PosOrderView>,
      actOptions: { create?: boolean } = {},
    ): Promise<PosOrderView | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setBusy(true);
      try {
        let current = orderRef.current;
        // A finished order's receipt is on the till: the next act starts a new order.
        if (current && current.status !== 'open' && actOptions.create) current = null;
        if (!current) {
          if (!actOptions.create) return null;
          current = await client.createOrder(scope);
        }
        const next = await fn(current);
        setOrder(next);
        setError(null);
        return next;
      } catch (caught) {
        fail(caught, 'That did not work. Try again.');
        // ⚠ Another till changed this order: show what it is now, then let them act again.
        if (caught instanceof Error && caught.message === POS_CONFLICT_MESSAGE) await reloadOrder();
        return null;
      } finally {
        inFlight.current = false;
        setBusy(false);
        void reloadPending();
      }
    },
    [client, scope, fail, reloadOrder, reloadPending],
  );

  const clear = useCallback(() => {
    setOrder(null);
    setError(null);
  }, []);

  const resume = useCallback(
    async (orderId: string) => {
      try {
        const found = await client.order(scope, orderId);
        if (!found) {
          setError('That order is no longer there.');
          return;
        }
        setOrder(found);
        setError(null);
      } catch (caught) {
        fail(caught, 'Could not open that order.');
      }
    },
    [client, scope, fail],
  );

  return {
    scope,
    client,
    catalogue,
    keymap,
    timeZone,
    order,
    pending,
    canSell,
    canDiscount,
    canRefund,
    live: realtime !== null,
    error,
    dismissError: () => setError(null),
    showError: fail,
    busy,
    act,
    clear,
    resume,
    reloadPending,
  };
}
