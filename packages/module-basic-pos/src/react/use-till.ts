'use client';

import { useHoldsFeature, useRealtime, useRealtimeLive, useWorkspaceTimeZone } from '@kwtech/module-kit/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_POS_ALERT_TONES, type PosAlertTones, readAlertTones } from '../domain/alert-tones.js';
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
import { onPosWrite } from './pos-local-events.js';
import { POS_NOT_LIVE_AFTER_MS, tillEventKind, tillRereads } from './view/live.js';
import { recordVersion } from './view/order-changes.js';
import { type PosRankMap, rankMap } from './view/popularity.js';
import { type PosStockMap, stockMap } from './view/stock.js';

/** How long after the last event the till reads again — a burst of events is one read. */
const REREAD_DEBOUNCE_MS = 200;

/**
 * Where this browser remembers the open order on its till, per workspace.
 *
 * A cart is saved on the server from its first line but is listed nowhere
 * until it is held, so a reload would otherwise strand it: saved, and out of
 * everyone's reach. Remembering its id here puts it back on the till it was
 * on. Per device, like the till itself, so localStorage (as chat's dock).
 */
const TILL_ORDER_STORAGE_PREFIX = 'kwtech:pos-till-order:';

function readTillOrderId(workspaceId: string): string | null {
  try {
    return window.localStorage.getItem(`${TILL_ORDER_STORAGE_PREFIX}${workspaceId}`);
  } catch {
    // Storage is blocked (private mode, a policy): the till works, it just starts clear after a reload.
    return null;
  }
}

function writeTillOrderId(workspaceId: string, orderId: string | null): void {
  try {
    const key = `${TILL_ORDER_STORAGE_PREFIX}${workspaceId}`;
    if (orderId) window.localStorage.setItem(key, orderId);
    else window.localStorage.removeItem(key);
  } catch {
    // As above: remembering is a convenience, never a reason to fail a sale.
  }
}

export interface TillState {
  scope: PosScopeView;
  client: PosClient;
  catalogue: PosCatalogueView | null;
  /** How many are left per item and variant, from the stock app; null when the store counts no stock. */
  stock: PosStockMap | null;
  /**
   * The store's "most ordered" ranking (issue #47); null until this store's
   * first read succeeds — the sell views then keep their old order (by name).
   * A later read that fails KEEPS the last one (see `reloadRanks`). ⚠ READ WHEN A SELL
   * VIEW OPENS (`reloadRanks`), never on a live event: tiles must not move
   * mid-order.
   */
  ranks: PosRankMap | null;
  /**
   * Reads the ranking again. Called by each sell view as it opens: this state
   * outlives them (the app keeps it while the Orders or Items tab is open), so
   * coming back to Sell picks up the day's new ranking, or retries one that
   * failed.
   */
  reloadRanks: () => Promise<void>;
  keymap: PosKeymap;
  /** The store's order reference options (issue #30), in its order; empty for none — the plain text box. */
  referenceOptions: readonly string[];
  /**
   * Order sounds (issue #68): the store's, and this person's own when they
   * kept one (`effectiveAlertTones` picks). Re-read with the settings, so a
   * change saved on another device is heard at once. `mine` is read only for
   * somebody who takes payment — the Cashier screen is theirs alone.
   */
  alertTones: { store: PosAlertTones; mine: PosAlertTones | null };
  timeZone: string;
  /** The order on the till: open, or just finished (its receipt). Null for a clear till. */
  order: PosOrderView | null;
  /** Held orders waiting (D8), oldest first: the ones Hold set aside, never a cart still being built. */
  pending: PosOrderSummaryView[];
  /**
   * True once the pending list has been read from the server at least once.
   * ⚠ Until then `pending` is the empty list the till STARTS with, not an
   * answer: a screen that compares reads (`useOrderAlerts`) must not take it
   * for "nothing was waiting", or every order would arrive as new.
   */
  pendingLoaded: boolean;
  /**
   * The latest version of each order this till has had on it (issue #68):
   * its own changes, which are never news. Recorded the moment the till
   * receives an order (`setOrder`), never after a render: a hold puts the
   * held order on the till and clears it at once, and the two can commit
   * in one render, so the held version would never be seen (CodeRabbit on
   * #71). A live map, read when the next pending read lands.
   */
  ownVersions: ReadonlyMap<string, number>;
  canSell: boolean;
  /** Pay, pay later, cancel and settle change (`pos:take_payment`, issue #23). Without it, orders are held for a cashier. */
  canTakePayment: boolean;
  canDiscount: boolean;
  canRefund: boolean;
  /** Mark items and sizes not available and back (`pos:set_availability`, issue #37): the sell views' Availability button. */
  canSetAvailability: boolean;
  /**
   * Whether other tills' changes are arriving by themselves: the SOCKET'S
   * state (`view/live.ts`), not merely that the app has one (issue #50).
   */
  live: boolean;
  /**
   * Reads everything the till shows again, as a reconnect's `sync` does.
   * Called when Sell is opened, so a screen that missed an event — the socket
   * was down — is current when somebody looks at it.
   */
  refresh: () => void;
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
  /**
   * Puts a pending (or any) order on the till. True once it is there; false
   * when it could not be read (gone, or the request failed — said in `error`),
   * and the till still holds what it held — or a later resume has replaced
   * this one, whose answer is dropped. ⚠ Callers open a sheet or a dialog
   * ONLY on true: otherwise it would show the order already on the till, with
   * its Pay button, as if it were the one tapped (CodeRabbit on #70).
   */
  resume: (orderId: string) => Promise<boolean>;
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
  const canTakePayment = useHoldsFeature(POS_FEATURE.takePayment);
  const canDiscount = useHoldsFeature(POS_FEATURE.discount);
  const canRefund = useHoldsFeature(POS_FEATURE.refund);
  const canSetAvailability = useHoldsFeature(POS_FEATURE.setAvailability);

  const [catalogue, setCatalogue] = useState<PosCatalogueView | null>(null);
  const [stock, setStock] = useState<PosStockMap | null>(null);
  const [ranks, setRanks] = useState<PosRankMap | null>(null);
  const [keymap, setKeymap] = useState<PosKeymap>(effectiveKeymap(null));
  const [referenceOptions, setReferenceOptions] = useState<readonly string[]>([]);
  const [alertTones, setAlertTones] = useState<TillState['alertTones']>({
    store: DEFAULT_POS_ALERT_TONES,
    mine: null,
  });
  // The workspace's zone, from the app's shell: receipts and "today" follow it.
  const timeZone = useWorkspaceTimeZone();
  const [order, setTillOrder] = useState<PosOrderView | null>(null);
  const [pending, setPending] = useState<PosOrderSummaryView[]>([]);
  const [pendingLoaded, setPendingLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The events handler reads the current order through this, so it is installed once.
  const orderRef = useRef<PosOrderView | null>(null);
  orderRef.current = order;

  /**
   * Puts an order on the till (or clears it), and remembers an OPEN one for a
   * reload. Explicit, not an effect on `order`: an effect would also run with
   * the empty till a fresh page starts on, and forget the order before it was
   * read back.
   */
  const ownVersions = useRef(new Map<string, number>());
  const setOrder = useCallback(
    (next: PosOrderView | null) => {
      if (next) recordVersion(ownVersions.current, next);
      setTillOrder(next);
      writeTillOrderId(scope.workspaceId, next?.status === 'open' ? next.id : null);
    },
    [scope.workspaceId],
  );

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
      const [settings, mine] = await Promise.all([
        client.settings(scope),
        // Not asked by somebody without the key: the binding would refuse, and the answer is unused.
        canTakePayment ? client.myAlertTones(scope).catch(() => null) : Promise.resolve(null),
      ]);
      setKeymap(effectiveKeymap(JSON.parse(settings.keymap) as Partial<PosKeymap>));
      setReferenceOptions(settings.referenceOptions);
      setAlertTones({
        store: readAlertTones(parseJson(settings.alertTones)),
        mine: mine?.mine ? readAlertTones(parseJson(mine.mine)) : null,
      });
    } catch {
      // The defaults serve: a till without the store's keymap still sells, without its
      // reference options it asks for a typed reference, and without its sounds it plays the defaults.
    }
  }, [client, scope, canTakePayment]);

  const loadStock = useCallback(async () => {
    try {
      setStock(stockMap(await client.stockLevels(scope)));
    } catch {
      // Counts are a courtesy: a till that cannot read them sells without them (I5).
      setStock(null);
    }
  }, [client, scope]);

  const reloadPending = useCallback(async () => {
    try {
      setPending(await client.orders(scope, 'pending'));
      setPendingLoaded(true);
    } catch (caught) {
      fail(caught, 'Could not load the pending orders.');
    }
  }, [client, scope, fail]);

  /**
   * Reads the order on the till again.
   *
   * ⚠ AN ANSWER THE TILL HAS MOVED PAST IS DROPPED. A re-read started by an
   * event can land after an act on this till answered with a NEWER version;
   * putting the older one back would make the cashier's next act "somebody
   * changed it" for a change that was their own. So it is dropped when an act
   * is running, when another order is on the till by then, or when it is older
   * than what is there. `duringAct` is the one caller inside an act: the
   * conflict path, which wants the order as it now is.
   */
  const reloadOrder = useCallback(
    async (options: { duringAct?: boolean } = {}) => {
      const current = orderRef.current;
      if (!current) return;
      try {
        const found = await client.order(scope, current.id);
        const latest = orderRef.current;
        if (!options.duringAct && inFlight.current) return;
        if (latest?.id !== current.id) return;
        if (found && found.version < latest.version) return;
        setOrder(found);
      } catch (caught) {
        fail(caught, 'Could not reload this order.');
      }
    },
    [client, scope, fail, setOrder],
  );

  // The order that was on this till before a reload goes back on it, if it is
  // still open and nothing was started meanwhile.
  useEffect(() => {
    const remembered = readTillOrderId(scope.workspaceId);
    if (!remembered) return;
    let cancelled = false;
    client
      .order(scope, remembered)
      .then((found) => {
        if (cancelled || orderRef.current) return;
        // Paid, cancelled or gone since: `setOrder(null)` also forgets it.
        setOrder(found?.status === 'open' ? found : null);
      })
      // Left remembered: the next reload tries again, and the till is usable clear meanwhile.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client, scope, setOrder]);

  useEffect(() => {
    void loadCatalogue();
    void loadSettings();
    void loadStock();
    void reloadPending();
  }, [loadCatalogue, loadSettings, loadStock, reloadPending]);

  /*
   * The store's ranking (issue #47): read by `reloadRanks` when a sell view
   * opens — never in `onEvent` below, because the ranking is fixed while a
   * sell view is open.
   *
   * ⚠ ONLY THE LATEST READ IS KEPT. The catalogue and stock reads correct
   * themselves on the next live event; the ranking is not read again until a
   * sell view reopens, so an answer for the store the till just LEFT would stay
   * on the new one. Each read takes a number, a change of store retires every
   * number, and an answer that is no longer the latest is dropped.
   */
  const rankRead = useRef(0);
  const reloadRanks = useCallback(async () => {
    rankRead.current += 1;
    const mine = rankRead.current;
    try {
      const answer = await client.ranks(scope);
      if (mine === rankRead.current) setRanks(rankMap(answer));
    } catch (caught) {
      /*
       * A courtesy, like the counts: the till sells the same without it. Said, so it can be found.
       *
       * ⚠ THE LAST RANKING IS KEPT, deliberately. It is this store's (a change of
       * store clears it) and at most a day old; dropping it on one failed read
       * would send every tile back to name order for a network blip and back
       * again on the next good read — the tiles moving that the ranking exists
       * to avoid. With nothing read yet, the till keeps its name order.
       */
      if (mine === rankRead.current) {
        console.warn('Point of sale: could not read the most-ordered ranking.', caught);
      }
    }
  }, [client, scope]);

  // A new store starts with no ranking, and an answer still coming for the old one is dropped.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the store IS the trigger — it runs exactly when the scope (or client) changes.
  useEffect(() => {
    setRanks(null);
    return () => {
      rankRead.current += 1;
    };
  }, [client, scope]);

  // ── live ──────────────────────────────────────────────────────────────────

  const kinds = useRef(new Set<string>());
  const onEvent = useCallback(
    (event: PosEventView) => {
      kinds.current.add(tillEventKind(event, orderRef.current?.id ?? null));
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        // Which reads a burst calls for is `tillRereads` (view/live.ts), where it is tested.
        const reads = tillRereads(kinds.current);
        kinds.current = new Set();
        if (reads.catalogue) void loadCatalogue();
        if (reads.stock) void loadStock();
        if (reads.settings) void loadSettings();
        if (reads.pending) void reloadPending();
        if (reads.order) void reloadOrder();
      }, REREAD_DEBOUNCE_MS);
    },
    [loadCatalogue, loadSettings, loadStock, reloadPending, reloadOrder],
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

  /*
   * This page's own writes (issue #50): references saved on Items reach the
   * Sell tab's dialog with the socket down, and a held order cancelled from
   * Orders leaves the pending column. ⚠ NOT WHILE AN ACT RUNS: that write is
   * the till's own, its answer is about to be put on the till, and the act
   * re-reads the pending list itself when it ends — an echo would only read
   * the same order twice.
   */
  useEffect(
    () =>
      onPosWrite(scope, (event) => {
        if (inFlight.current) return;
        onEvent(event);
      }),
    [scope, onEvent],
  );

  /*
   * Coming back to the window — another app, another browser tab, a phone
   * woken up — reads everything again, as a reconnect does. Whatever the socket
   * missed meanwhile is on screen before anybody acts on it (issue #50).
   */
  const sync = useCallback(() => onEvent({ kind: 'sync', orderId: null, actorId: null }), [onEvent]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', sync);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', sync);
    };
  }, [sync]);

  // The socket's own state, by the till's threshold (module-kit's one rule, `isRealtimeLive`).
  const live = useRealtimeLive(POS_NOT_LIVE_AFTER_MS);

  // ── acts ──────────────────────────────────────────────────────────────────

  /**
   * The latest resume's number (see `resume`). ⚠ ALSO RETIRED BY ANY OTHER
   * CHANGE TO THE TILL: an act starting or the till being cleared moves it on,
   * so a slow read started before — the cashier opened an order, then cleared
   * the till or started another in Take orders — can never land afterwards and
   * replace the newer order (CodeRabbit on #70).
   */
  const resumeRead = useRef(0);

  const act = useCallback(
    async (
      fn: (order: PosOrderView) => Promise<PosOrderView>,
      actOptions: { create?: boolean } = {},
    ): Promise<PosOrderView | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      resumeRead.current += 1;
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
        if (caught instanceof Error && caught.message === POS_CONFLICT_MESSAGE) await reloadOrder({ duringAct: true });
        return null;
      } finally {
        inFlight.current = false;
        setBusy(false);
        void reloadPending();
      }
    },
    [client, scope, fail, reloadOrder, reloadPending, setOrder],
  );

  const clear = useCallback(() => {
    resumeRead.current += 1;
    setOrder(null);
    setError(null);
  }, [setOrder]);

  /**
   * ⚠ ONLY THE LATEST TAP COUNTS. Two quick taps start two reads, and the
   * first can answer last; putting it on the till then would swap the order
   * under a sheet already open for the second, with its Pay button (CodeRabbit
   * on #70). Each resume takes a number, and an answer that is no longer the
   * latest is dropped and reported as not opened.
   */
  const resume = useCallback(
    async (orderId: string): Promise<boolean> => {
      resumeRead.current += 1;
      const mine = resumeRead.current;
      try {
        const found = await client.order(scope, orderId);
        if (mine !== resumeRead.current) return false;
        if (!found) {
          setError('That order is no longer there.');
          return false;
        }
        setOrder(found);
        setError(null);
        return true;
      } catch (caught) {
        // A failure of a tap since replaced says nothing about the order now being opened.
        if (mine === resumeRead.current) fail(caught, 'Could not open that order.');
        return false;
      }
    },
    [client, scope, fail, setOrder],
  );

  return {
    scope,
    client,
    catalogue,
    stock,
    ranks,
    reloadRanks,
    keymap,
    referenceOptions,
    alertTones,
    timeZone,
    order,
    pending,
    pendingLoaded,
    ownVersions: ownVersions.current,
    canSell,
    canTakePayment,
    canDiscount,
    canRefund,
    canSetAvailability,
    live,
    refresh: sync,
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

/** JSON text from the API, or null when it does not parse: `readAlertTones` then gives the defaults. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
