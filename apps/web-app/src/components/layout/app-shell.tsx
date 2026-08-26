import { SessionKeeper } from '@kwtech/module-auth/react';
import { PermissionsProvider } from '@kwtech/module-permissions/react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { Header } from '@/components/layout/header';
import { buildAccountNav, buildNav } from '@/components/layout/nav';
import { Sidebar } from '@/components/layout/sidebar';
import { isCollapsedValue, SIDEBAR_COOKIE } from '@/components/layout/sidebar-state';
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
  const [{ viewer, permissions, expiresAt }, cookieStore] = await Promise.all([getSessionSnapshot(), cookies()]);

  if (!viewer) redirect('/auth/signin');

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
    <PermissionsProvider value={permissions ?? undefined}>
      {/*
        Renders nothing. It spends the refresh token before the access token
        expires — without it a signed-in person was returned to the sign-in page
        after fifteen minutes, with an unused week-long refresh cookie beside
        them. It also notices a session revoked from another device, though that
        is UX rather than enforcement: see the component.
      */}
      <SessionKeeper expiresAt={expiresAt} />
      <div className="flex min-h-dvh">
        <Sidebar
          groups={buildNav(permissions?.granted)}
          defaultCollapsed={isCollapsedValue(cookieStore.get(SIDEBAR_COOKIE)?.value)}
          brand={appBrand()}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header title={title} viewer={viewer} accountNav={buildAccountNav(permissions?.granted)} />
          <main className="flex-1 overflow-auto px-4 py-6 sm:px-6">{children}</main>
        </div>
      </div>
    </PermissionsProvider>
  );
}
