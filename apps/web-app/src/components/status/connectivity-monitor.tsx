'use client';

import { useStatusChannel } from '@kwtech/module-kit/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import type { HealthState } from '@/app/api/health/route';

/**
 * Watches whether the server is reachable, and says so in the status bar.
 *
 * ## What it fixes
 *
 * Nothing told anyone the API was down. A save silently failed, a page silently
 * rendered stale, and the only symptom was that the app had stopped behaving —
 * which reads as "the app is broken", not "the server is unreachable". Those
 * lead to different actions, and only one of them is right.
 *
 * ## Scheduling
 *
 * Deliberately shaped like SessionKeeper, because the failure modes are the
 * same ones:
 *
 *   - backoff, not a fixed interval — a server that is down stays down for
 *     minutes, and a one-second poll through an outage is a self-inflicted load
 *     spike on the thing already struggling. It doubles to a 30s ceiling.
 *   - `visibilitychange` — a background tab has its timers throttled hard, so a
 *     hidden tab is not polled at all and is probed the moment it is looked at.
 *     Polling a tab nobody is reading is work for an audience of nobody.
 *   - `online` / `offline` — the browser knows about its own network instantly,
 *     and waiting out a backoff to rediscover it is a bar that lags reality.
 *
 * ## Renders nothing
 *
 * Like SessionKeeper: a behaviour mounted in the shell. What it has to say goes
 * onto the status channel, so the one bar shows it and this component has no
 * opinion about where that bar is.
 */

/** One id for the life of the app, so republishing REPLACES rather than piles up. */
const STATUS_ID = 'connectivity';

/** The steady-state poll once everything is healthy. */
const HEARTBEAT_MS = 30_000;

/** First retry after a failure, doubling to the ceiling. */
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

/**
 * How long "Reconnected" stays before the bar goes away.
 *
 * It exists at all because a bar that vanishes the instant service returns
 * leaves someone who looked away wondering whether they imagined the outage —
 * and, more usefully, whether the thing they were doing went through.
 */
const RECONNECTED_MS = 4_000;

/**
 * ±20% of the delay, so a hundred tabs that went down together do not come back
 * in lockstep and arrive as one thundering retry.
 */
function jitter(ms: number): number {
  return Math.round(ms * (0.8 + Math.random() * 0.4));
}

type Reachability = HealthState | 'offline';

export function ConnectivityMonitor() {
  const status = useStatusChannel();
  const router = useRouter();

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Consecutive failures, which is what the backoff is a function of. */
  const failures = useRef(0);
  /** The last state acted on, so a steady condition is not re-announced every probe. */
  const last = useRef<Reachability | null>(null);
  const inFlight = useRef(false);
  const cancelled = useRef(false);
  /*
   * The probe needs to schedule the next probe — a genuine cycle. A ref breaks
   * it honestly: a timer reads whatever the function is when it FIRES, rather
   * than capturing the one that existed when it was set. Two useCallbacks
   * closing over each other type-check and then quietly hold a stale closure.
   */
  const probeRef = useRef<() => void>(() => {});

  const report = useCallback(
    (state: Reachability) => {
      // Same condition as last time: the bar already says it. Republishing
      // would be a live-region announcement every few seconds of news that has
      // not changed.
      if (last.current === state) return;

      const previous = last.current;
      last.current = state;

      if (clearTimer.current) clearTimeout(clearTimer.current);

      if (state === 'ok') {
        /*
         * First probe of the session, and it was fine. Say nothing — the bar's
         * whole value is that it is absent until something is wrong.
         */
        if (previous === null) {
          status.retract(STATUS_ID);
          return;
        }

        status.publish({
          id: STATUS_ID,
          level: 'success',
          text: 'Reconnected.',
          source: 'connectivity',
          sticky: true,
        });
        clearTimer.current = setTimeout(() => status.retract(STATUS_ID), RECONNECTED_MS);

        /*
         * Re-fetch what failed while it was down.
         *
         * Server components rendered during the outage got the fallback — an
         * empty list, a missing viewer — and nothing about recovery re-runs
         * them. Without this the bar goes green over a page that is still
         * showing the outage's data, which is the most misleading state of all.
         */
        router.refresh();
        return;
      }

      status.publish({
        id: STATUS_ID,
        // 'error' only when nothing is getting through. Offline is the reader's
        // own network and degraded is a server that still answers — both are
        // warnings, because in neither case is the app itself broken.
        level: state === 'unreachable' ? 'error' : 'warning',
        text: MESSAGES[state],
        source: 'connectivity',
        // Survives navigation: an unreachable server is not a property of the
        // page you happen to be on.
        sticky: true,
        ...(state === 'offline' ? {} : { action: { label: 'Retry now', run: () => probeRef.current() } }),
      });
    },
    [status, router],
  );

  const schedule = useCallback((delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    if (cancelled.current) return;
    timer.current = setTimeout(() => probeRef.current(), delay);
  }, []);

  const probe = useCallback(async () => {
    if (cancelled.current || inFlight.current) return;

    /*
     * The browser's own answer, and it is authoritative in one direction: if it
     * says there is no network there is no point spending a request to confirm
     * it. The converse is not true — `onLine` true only means an interface is
     * up, not that anything is at the other end — so a true value is not
     * treated as health.
     */
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      report('offline');
      // No timer: the `online` event is a better wake-up than any interval, and
      // polling with no network is pure battery.
      return;
    }

    inFlight.current = true;
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      const body = (await response.json()) as { state?: HealthState };
      const state: HealthState = body.state ?? 'unreachable';

      if (cancelled.current) return;
      report(state);

      if (state === 'ok') {
        failures.current = 0;
        schedule(jitter(HEARTBEAT_MS));
      } else {
        /*
         * `degraded` backs off too. The API is answering, so this is not about
         * load — it is that a dead database is not fixed in a second, and
         * asking every second produces a log full of the same line.
         */
        failures.current += 1;
        schedule(jitter(Math.min(BACKOFF_START_MS * 2 ** (failures.current - 1), BACKOFF_MAX_MS)));
      }
    } catch {
      // The route handler itself is unreachable: this app is down, or the tab
      // has no route to it. Same message either way — nothing is getting
      // through — and the same backoff.
      if (cancelled.current) return;
      report('unreachable');
      failures.current += 1;
      schedule(jitter(Math.min(BACKOFF_START_MS * 2 ** (failures.current - 1), BACKOFF_MAX_MS)));
    } finally {
      inFlight.current = false;
    }
  }, [report, schedule]);

  useEffect(() => {
    cancelled.current = false;
    probeRef.current = () => void probe();

    // Immediately, not after the first interval: an app opened against a dead
    // server should say so on the first paint, not thirty seconds in.
    probeRef.current();

    const onOnline = () => {
      // The network is back. Start the backoff over — the old count was about a
      // condition that no longer holds.
      failures.current = 0;
      probeRef.current();
    };
    const onOffline = () => report('offline');
    const onVisible = () => {
      if (document.visibilityState === 'visible') probeRef.current();
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled.current = true;
      if (timer.current) clearTimeout(timer.current);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      /*
       * Retract on unmount. The shell mounts one of these; leaving a sticky
       * error behind after it goes would outlive the thing that could ever
       * clear it.
       */
      status.retract(STATUS_ID);
    };
  }, [probe, report, status]);

  return null;
}

/**
 * The three things that can be wrong, in words someone can act on.
 *
 * Each names WHERE the problem is, because that is the only part the reader can
 * do anything about: their own network, the server, or the server's database.
 * "Something went wrong" would be true of all three and useful for none.
 */
const MESSAGES: Record<Exclude<Reachability, 'ok'>, string> = {
  offline: 'You are offline. Changes will not be saved until your connection returns.',
  unreachable: 'Cannot reach the server. Retrying automatically — changes will not be saved.',
  degraded: 'The server is reachable but its database is not responding. Some pages may fail to load.',
};
