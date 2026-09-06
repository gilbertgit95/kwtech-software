import { SessionKeeper } from '@kwtech/module-auth/react';
import { PermissionsProvider } from '@kwtech/module-permissions/react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { BareShell } from '@/components/layout/bare-shell';
import { Header } from '@/components/layout/header';
import { AppIconSet } from '@/components/layout/icon-set';
import { buildAccountNav, buildNav } from '@/components/layout/nav';
import { Sidebar } from '@/components/layout/sidebar';
import { isCollapsedValue, SIDEBAR_COOKIE } from '@/components/layout/sidebar-state';
import { ConnectivityMonitor } from '@/components/status/connectivity-monitor';
import { StatusBarHost } from '@/components/status/status-bar-host';
import { appBrand } from '@/config/env';
import { getSessionSnapshot } from '@/lib/session-query';

/**
 * The signed-in shell: side drawer, main header, page body.
 *
 * A COMPONENT, not a layout, and that is forced rather than chosen. PLAN
 * §12.11 strategy A puts every module route behind one catch-all, so Next
 * cannot see the individual routes and cannot give them nested layouts —
 * exactly the cost the catch-all's comment records. `/` and the catch-all each
 * wrap themselves. Moving to generated stubs (strategy C) turns this back into
 * a layout with no change to what it renders.
 *
 * IT IS NOT A SECURITY GATE. The redirect below is UX: it sends a signed-out
 * visitor somewhere useful instead of rendering an account menu with no account
 * in it. Enforcement is the API's — every request carries the bearer token and
 * is authorised there. Treating a render-time check as protection is how a UI
 * ends up "guarded" by something an attacker never runs.
 *
 * The drawer's collapsed state is read here rather than in the client, so the
 * shell renders at the right width instead of snapping to it after hydration.
 */
export async function AppShell({ title, children }: { title: string; children: ReactNode }) {
  /*
   * THE WEB-SIDE SEAM, and the only line in this app where the two modules
   * meet: auth owns the token, permissions is handed it. Neither imports the
   * other — same arrangement, and same reason, as resolvePrincipal on the
   * server (PLAN §9).
   */
  /*
   * ONE request for both, where this used to make two sequential REST calls —
   * `GET /auth/profile`, then `GET /permissions/me` with the token the first one
   * needed. Each paid a full round trip before the next could start; the two
   * fields now resolve concurrently inside a single GraphQL operation.
   *
   * The seam is unchanged in kind, only in shape: neither module names the
   * other, and the APP composes the query — see @/lib/session-query.
   */
  const [{ viewer, permissions, expiresAt, reachable }, cookieStore] = await Promise.all([
    getSessionSnapshot(),
    cookies(),
  ]);

  /*
   * NO VIEWER SPLITS TWO WAYS, and conflating them was a real bug: with the API
   * down every render fell through to the redirect, so a signed-in person was
   * sent to a sign-in page that could not sign them in either. The outage was
   * reported as a sign-out, which is the one explanation that makes it look
   * like the reader's own fault.
   */
  if (!viewer) {
    // Asked, and told nobody is signed in. A redirect is right.
    if (reachable) redirect('/auth/signin');

    /*
     * Could not ask. Say so and stay put — the monitor inside BareShell polls,
     * and `router.refresh()` on recovery re-runs this render, so the session
     * comes back on its own without anyone reloading.
     */
    return (
      <BareShell>
        <div className="grid min-h-dvh place-items-center px-6 text-center">
          <div className="max-w-sm space-y-2">
            <h1 className="text-lg font-medium">Cannot reach the server</h1>
            <p className="text-sm text-muted-foreground">
              You are still signed in. This page will come back on its own once the connection returns.
            </p>
          </div>
        </div>
      </BareShell>
    );
  }

  return (
    /*
     * Mounted here, so `<FeatureGate>` works inside any page that renders in
     * this shell — including RolesPage, which arrives from the module package
     * and cannot mount a provider of its own.
     *
     * The context is resolved on the server and passed down, so the first paint
     * is already correct: a gate that started as "denied" and flipped open
     * after hydration would flash every privileged control at everyone.
     */
    /*
     * The app names what its icons DRAW; the packages only ever handle names.
     * Mounted here so a picker inside a page that arrives from a module — which
     * a route descriptor hands `params` and nothing else — still has the set,
     * with no prop threaded through the descriptor.
     *
     * A CLIENT wrapper, not `IconSetProvider` directly: the map holds React
     * components, and a function cannot cross the server/client boundary.
     */
    <AppIconSet>
      <PermissionsProvider value={permissions ?? undefined}>
        {/*
        Renders nothing. It spends the refresh token before the access token
        expires — without it a signed-in person was returned to the sign-in page
        after fifteen minutes, with an unused week-long refresh cookie beside
        them. It also notices a session revoked from another device, though that
        is UX rather than enforcement: see the component.
      */}
        <SessionKeeper expiresAt={expiresAt} />
        {/* Renders nothing either. Publishes reachability onto the status channel. */}
        <ConnectivityMonitor />
        {/*
        `h-dvh`, NOT `min-h-dvh` — and this was a latent bug as well as what the
        grid pages need.

        With a min-height the shell's height is `auto`, so `flex-1` on <main>
        resolved against its own content and `overflow-auto` never fired: tall
        content grew the shell and the whole PAGE scrolled, carrying the header,
        the drawer and the status bar off screen with it. The status bar's own
        comment below already assumed otherwise.

        A definite height makes <main> a real scroll container: the chrome stays
        put, content scrolls inside it, and a child asking for `h-full` finally
        has something to resolve against — which is what lets a data grid fill
        the space instead of collapsing to nothing.
      */}
        <div className="flex h-dvh">
          <Sidebar
            groups={buildNav(permissions?.granted)}
            defaultCollapsed={isCollapsedValue(cookieStore.get(SIDEBAR_COOKIE)?.value)}
            brand={appBrand()}
          />
          {/*
          `min-h-0` alongside `flex-1`: a flex item's default `min-height: auto`
          refuses to shrink below its content, which would push the column past
          the viewport and undo the definite height above.
        */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Header
              title={title}
              viewer={viewer}
              accountNav={buildAccountNav(permissions?.granted)}
              /*
               * `?? []` for the same reason the nav filter fails closed: a
               * permission context that could not be resolved means "holds
               * nothing", never "assume the usual". Here the cost of guessing is
               * only a wrong badge — but a badge claiming a rank the API would
               * refuse is exactly the kind of confident wrongness that gets
               * reported as a bug in the API.
               */
              roles={permissions?.appRoles ?? []}
            />
            {/* `min-h-0` for the same reason as the column. */}
            <main className="min-h-0 flex-1 overflow-auto px-4 py-6 sm:px-6">{children}</main>
            {/*
            A flex ITEM after the scrolling main, not a fixed overlay.
            `main` already owns its own scrollbar, so the bar sits below it and
            stays in view without covering anything — a fixed strip would hide
            the last row of whatever is on screen, which on a table is the row
            someone scrolled down to read.

            It renders nothing at all when there is nothing to say, so it costs
            no height in the ordinary case.
          */}
            <StatusBarHost />
          </div>
        </div>
      </PermissionsProvider>
    </AppIconSet>
  );
}
