import { SessionKeeper } from '@kwtech/module-auth/react';
import { FeatureAccessProvider, WorkspaceTimeZoneProvider } from '@kwtech/module-kit/react';
import { scopePath } from '@kwtech/module-permissions';
import { displayApplyScript } from '@kwtech/web-ui';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { userAgent } from 'next/server';
import type { ReactNode } from 'react';
import { BareShell } from '@/components/layout/bare-shell';
import { AppIconSet } from '@/components/layout/icon-set';
import { RememberOrganization } from '@/components/layout/remember-organization';
import { AccountDisplay } from '@/components/mobile/account-display';
import { mobileDestinations } from '@/components/mobile/mobile-destinations';
import type { MobilePlaceContext } from '@/components/mobile/mobile-place';
import {
  FullSiteProvider,
  MobileBottomNav,
  type MobileScreenEntry,
  MobileScreensProvider,
  MobileSectionStrip,
  type MobileTabEntry,
} from '@/components/mobile/mobile-screens';
import { MobileTopBar } from '@/components/mobile/mobile-top-bar';
import type { MobileView } from '@/components/mobile/mobile-view';
import { ConnectivityMonitor } from '@/components/status/connectivity-monitor';
import { StatusBarHost } from '@/components/status/status-bar-host';
import { appBrand } from '@/config/env';
import { canUseFullSite } from '@/lib/layout-choice';

/**
 * The phone layout's frame (issue #22): a top bar, the page between, and a
 * bottom bar of the workspace's screens.
 *
 * The phone's `AppShell`, and it keeps every promise that one makes, because
 * they are about the session and not about the screen size:
 *
 *   - Not a security gate. Signed out redirects to sign-in as UX; the API
 *     authorises every request.
 *   - "Signed out" and "cannot ask" stay apart: with the API down it says so
 *     and waits, rather than sending a signed-in person to sign in.
 *   - The account's display sizes apply before it paints, the session is kept
 *     renewed, reachability is published, the visited workspace remembered.
 *
 * ⚠ IT IMPORTS NO MODULE'S PAGES — that is what the phone layout is for. The
 * permissions come through module-kit's `FeatureAccessProvider` (what
 * `useHoldsFeature` reads) rather than `PermissionsProvider`, which lives in
 * the permissions module's React layer beside its admin pages. A screen may
 * gate a control with `useHoldsFeature`; nothing on a phone needs more.
 */
export async function MobileShell({
  place,
  screens = [],
  tabs = [],
  initialView = HOME,
  children,
}: {
  place: MobilePlaceContext;
  /** The workspace's apps the viewer holds, already rendered and filtered. Empty outside a workspace. */
  screens?: readonly MobileScreenEntry[];
  /** Module destinations for the bottom bar (Chat, Inbox), already filtered by app-level grants. */
  tabs?: readonly MobileTabEntry[];
  initialView?: MobileView;
  children: ReactNode;
}) {
  const { snapshot, scope, activeOrganizationId, activeWorkspaceId, workspaces, activeWorkspace } = place;
  // The PHONE layout's sizes, never the full site's: kept apart per account since issue #22.
  const { viewer, permissions, organizations, expiresAt, mobileDisplay: display, reachable } = snapshot;

  if (!viewer) {
    // Asked, and told nobody is signed in: the shared sign-in page, the same one every device gets.
    if (reachable) redirect('/auth/signin');

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

  /*
   * Whether this render is a FULL page load or an in-app navigation. Only a
   * full load gets the inline display script: it is the only render where a
   * script runs, and before the first paint is exactly when it must. An
   * in-app navigation gets `AccountDisplay` instead — see that component.
   *
   * Told apart by `Sec-Fetch-Dest`, which every current browser sends:
   * `document` for a page load, `empty` for the fetch Next makes on an in-app
   * navigation. NOT Next's own `RSC` header — Next strips that before a page
   * (or the proxy) can read it. Absent, it counts as a full load: the script
   * then rides along as before, which costs a console warning at worst.
   */
  const requestHeaders = await headers();
  const fetchDest = requestHeaders.get('sec-fetch-dest');
  // Only a non-phone may switch to the full site — a phone viewing this page always stays on it.
  const fullSiteAllowed = canUseFullSite(userAgent({ headers: requestHeaders }).device.type);
  const fullLoad = fetchDest === null || fetchDest === 'document';

  /*
   * THE BOTTOM BAR ON EVERY PAGE THAT KNOWS THE WORKSPACE. The workspace's
   * own page hands its destinations in. Any other phone page — a picker,
   * "not on the mobile view yet" — used to have no bar at all, which left
   * somebody who arrived there (switching layout lands on whatever page was
   * open) with no way to Home, Apps, Chat or the Inbox. Here the same
   * destinations, under the same permission filter, LINK to the workspace's
   * page instead (`linkBase`).
   */
  const linked =
    screens.length === 0 && tabs.length === 0 && activeOrganizationId && activeWorkspaceId
      ? {
          base: scopePath({ organizationId: activeOrganizationId, workspaceId: activeWorkspaceId }),
          ...(await mobileDestinations(activeOrganizationId, activeWorkspaceId, { withNodes: false })),
        }
      : null;

  const ownOrganization = organizations.some((organization) => organization.organizationId === scope.organizationId);

  return (
    <AppIconSet>
      {fullLoad ? (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: its values are checked against the fixed steps by displayApplyScript, never interpolated as given.
        <script dangerouslySetInnerHTML={{ __html: displayApplyScript(display) }} />
      ) : (
        <AccountDisplay display={display} />
      )}
      <FullSiteProvider allowed={fullSiteAllowed} userId={viewer.id}>
        <FeatureAccessProvider value={permissions?.effective ?? []}>
          <SessionKeeper expiresAt={expiresAt} />
          <ConnectivityMonitor />
          {/* Only a URL visit is remembered, and only to one of the viewer's own — as `AppShell` does. */}
          <RememberOrganization
            organizationId={ownOrganization ? (scope.organizationId ?? null) : null}
            workspaceId={scope.workspaceId && activeWorkspaceId === scope.workspaceId ? scope.workspaceId : null}
          />
          {/*
           * Keyed by the workspace: moving to another one is an in-app
           * navigation now, and without the key the open tab, the screens kept
           * mounted and an open sheet would all carry over from the last one.
           */}
          <MobileScreensProvider
            key={activeWorkspaceId ?? 'none'}
            workspaceId={activeWorkspaceId}
            linkBase={linked?.base ?? null}
            screens={linked?.screens ?? screens}
            tabs={linked?.tabs ?? tabs}
            initial={initialView}
          >
            {/*
             * `h-dvh` and a column, so the bars stay put and only the middle
             * scrolls — the dynamic viewport height, which follows a phone
             * browser's address bar as it slides away, where `vh` would leave
             * the bottom bar under it.
             */}
            <div className="flex h-dvh flex-col bg-background">
              <MobileTopBar
                brandName={appBrand().name}
                viewer={{ name: viewer.displayName ?? viewer.username, email: viewer.email }}
                account={viewer}
                /*
                 * App-level keys for the account panels. On a tenant's page the
                 * snapshot was read inside the tenant, so the app-level reading
                 * comes with the nav context; on `/` it IS the snapshot's.
                 */
                accountGrants={scope.organizationId ? place.appGranted : (permissions?.effective ?? [])}
                organizations={organizations.map((organization) => ({
                  id: organization.organizationId,
                  name: organization.organizationName,
                  detail: organization.roleLabel,
                }))}
                workspaces={workspaces.map((workspace) => ({
                  id: workspace.id,
                  name: workspace.name,
                  detail: workspace.roleLabel,
                }))}
                activeOrganizationId={activeOrganizationId}
                activeWorkspaceId={activeWorkspaceId}
              />
              <MobileSectionStrip />
              <main className="min-h-0 flex-1 overflow-hidden">
                <WorkspaceTimeZoneProvider timeZone={activeWorkspace?.timeZone ?? null}>
                  {children}
                </WorkspaceTimeZoneProvider>
              </main>
              <StatusBarHost />
              <MobileBottomNav />
            </div>
          </MobileScreensProvider>
        </FeatureAccessProvider>
      </FullSiteProvider>
    </AppIconSet>
  );
}

const HOME: MobileView = { tab: 'home', app: null, section: null };
