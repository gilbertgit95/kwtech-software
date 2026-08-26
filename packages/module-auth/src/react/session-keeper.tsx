'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Keeps the session alive, and notices when it stops being one.
 *
 * ## What it fixes
 *
 * The access token lives fifteen minutes; the session lives a week. Nothing was
 * spending the refresh token, so a signed-in person was thrown back to the
 * sign-in page a quarter of an hour after arriving — with a perfectly good
 * refresh cookie sitting unread beside them. This is the loop that spends it.
 *
 * ## What it does NOT do — and this is worth being exact about
 *
 * **It is not a security control.** Revoking a session is enforced server-side,
 * at `/auth/refresh`, by a row that says so. This component makes an HONEST
 * client notice sooner. It cannot make a stolen token stop working, because
 * whoever stole it will not run this loop — they will send the token straight to
 * the API, which verifies it by signature alone.
 *
 * So it buys UX: a tab that has been revoked from another device lands on the
 * sign-in page in about a minute instead of hanging on stale data. The window in
 * which a STOLEN token still works is `AUTH_ACCESS_TOKEN_TTL`, and the only
 * things that shrink it are a lower TTL or a server-side revocation denylist.
 *
 * ## Scheduling
 *
 * Renews at 60% of the remaining lifetime rather than on a fixed interval, so a
 * deployment that changes the TTL does not need this file changed too, and a
 * short TTL does not mean a stale tab. There are two extra triggers because a
 * timer alone is not enough:
 *
 *   - `visibilitychange` — a backgrounded tab has its timers throttled hard, and
 *     a laptop that slept through the whole window wakes with an expired token
 *     and a timer that has not fired.
 *   - `online` — a refresh that failed because the network was gone should be
 *     retried when it comes back, not at the next scheduled tick.
 *
 * ## Multiple tabs
 *
 * Refresh ROTATES the token, and the server refuses the loser of a race — two
 * callers holding one token is how a theft looks from there. So renewals are
 * serialised across the origin with Web Locks, and a 401 is retried once before
 * it is believed. Both are needed: the lock prevents the race, the retry covers
 * the browsers without locks and the instant a tab is opened mid-rotation.
 */
export function SessionKeeper({
  expiresAt,
  signInHref = '/auth/signin',
  basePath = '/api/auth',
}: {
  /**
   * ISO-8601 access-token expiry, from the server render. Absent means "renew
   * soon and find out" — better than assuming a lifetime this component has no
   * way to know.
   */
  expiresAt?: string | null;
  signInHref?: string;
  basePath?: string;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against the tab-wake and timer paths firing at once, which would
  // rotate the refresh token twice and make the second call lose the race.
  const inFlight = useRef(false);
  /*
   * The timer needs `renew`, and `renew` needs to reschedule — a genuine cycle.
   * A ref breaks it honestly: the timer reads whatever `renew` is when it FIRES,
   * rather than the one that existed when it was set. Writing it as two
   * useCallbacks closing over each other type-checks and then silently captures
   * a stale function the day a dependency changes.
   */
  const renewRef = useRef<() => Promise<void>>(async () => {});

  const schedule = useCallback((iso: string | null) => {
    if (timer.current) clearTimeout(timer.current);

    const remaining = iso ? new Date(iso).getTime() - Date.now() : 0;
    // Floors and ceilings, both load-bearing: never hammer the endpoint on a
    // clock skew that reads as "expired", and never sleep so long that a tab
    // open all afternoon misses a revocation entirely.
    const delay = Math.min(Math.max(remaining * 0.6, 30_000), 10 * 60_000);

    timer.current = setTimeout(() => void renewRef.current(), delay);
  }, []);

  const renew = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      /*
       * ONE TAB AT A TIME, ACROSS THE WHOLE ORIGIN.
       *
       * `/auth/refresh` ROTATES: the update is conditional on the refresh token
       * presented, so of two tabs refreshing at once exactly one wins and the
       * other is told `session_revoked` — which is correct on the server, where
       * two callers holding one token is indistinguishable from a theft. It is
       * wrong here, where it is just a second tab.
       *
       * Without this lock, anyone with the app open twice gets signed out at
       * random, and `visibilitychange` makes it near-certain: restoring a
       * minimised window fires it in every visible tab at the same instant.
       *
       * Web Locks is origin-scoped and survives across tabs. Where it is missing
       * the retry below is the safety net rather than the lock.
       */
      const run = async () => {
        let response = await fetch(`${basePath}/refresh`, { method: 'POST', credentials: 'same-origin' });

        if (response.status === 401) {
          /*
           * ONE RETRY, and it is not superstition.
           *
           * A 401 here has two very different causes: the session really ended,
           * or another tab rotated the token a moment ago and this request
           * carried the cookie it had already replaced. In the second case our
           * cookie is now the winner's fresh one, so simply asking again
           * succeeds. Redirecting without checking would sign out a perfectly
           * good session because of a race with ourselves.
           */
          await new Promise((resolve) => setTimeout(resolve, 400));
          response = await fetch(`${basePath}/refresh`, { method: 'POST', credentials: 'same-origin' });
        }

        if (response.status === 401) {
          /*
           * The session really is gone — revoked elsewhere, expired, or signed
           * out. The route handler has already cleared the cookies, so a FULL
           * navigation is required: a soft one would re-render from a client
           * cache that still believes there is a viewer.
           */
          window.location.assign(signInHref);
          return;
        }

        if (!response.ok) {
          // 503 and friends: the API is restarting, not the session ending. Try
          // again shortly rather than signing a healthy user out over a deploy.
          schedule(null);
          return;
        }

        const body = (await response.json()) as { expiresAt?: string | null };
        schedule(body.expiresAt ?? null);
      };

      if (typeof navigator !== 'undefined' && navigator.locks) {
        await navigator.locks.request('kwtech-auth-refresh', run);
      } else {
        await run();
      }
    } catch {
      schedule(null);
    } finally {
      inFlight.current = false;
    }
  }, [basePath, signInHref, schedule]);

  useEffect(() => {
    renewRef.current = renew;
    schedule(expiresAt ?? null);

    const onWake = () => {
      // Only when the tab is actually visible: `visibilitychange` fires on the
      // way out too, and renewing as someone leaves is work nobody is waiting on.
      if (document.visibilityState === 'visible') void renew();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', onWake);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onWake);
    };
  }, [expiresAt, renew, schedule]);

  // Renders nothing. It is a behaviour mounted in the shell, not a control.
  return null;
}
