import { SessionKeeper } from '@kwtech/module-auth/react';
import { FEATURE } from '@kwtech/module-permissions';
import { PermissionsProvider } from '@kwtech/module-permissions/react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  ACTIVE_ORGANIZATION_COOKIE,
  ACTIVE_WORKSPACE_COOKIE,
  resolveActiveOrganization,
  resolveActiveWorkspace,
} from '@/components/layout/active-organization';
import { BareShell } from '@/components/layout/bare-shell';
import { Header } from '@/components/layout/header';
import { AppIconSet } from '@/components/layout/icon-set';
import { buildAccountNav, buildNav } from '@/components/layout/nav';
import { RememberOrganization } from '@/components/layout/remember-organization';
import { Sidebar } from '@/components/layout/sidebar';
import { isCollapsedValue, SIDEBAR_COOKIE } from '@/components/layout/sidebar-state';
import { ConnectivityMonitor } from '@/components/status/connectivity-monitor';
import { StatusBarHost } from '@/components/status/status-bar-host';
import { appBrand } from '@/config/env';
import {
  getNavContext,
  getOrganizationIdentity,
  getOrganizationPlan,
  getSessionSnapshot,
  type SessionScope,
} from '@/lib/session-query';

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
export async function AppShell({
  title,
  scope = {},
  children,
}: {
  title: string;
  /**
   * Which organization (and workspace) this page is inside, from the URL.
   *
   * A PROP, not something read here. This is a component rather than a layout —
   * PLAN §12.11 strategy A puts every module route behind one catch-all, so
   * Next cannot give these routes a nested layout — which means there is no
   * request pathname available in here at all. The catch-all parses it once,
   * with `parseScope`, and hands the result to this and to its own denial
   * check, so both resolve the viewer's rights in the same place.
   *
   * ⚠ Its two callers MUST pass the same scope they pass to any other
   * `getSessionSnapshot()` call in the render: that function is `cache()`d on
   * its arguments, so a mismatch is both a second round trip and a second,
   * different answer — the app-level one, which grants a tenant-only member
   * nothing.
   *
   * Empty on `/`, which is app level and belongs to no tenant.
   */
  scope?: SessionScope;
  children: ReactNode;
}) {
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
  const [{ viewer, permissions, organizations, expiresAt, reachable }, cookieStore] = await Promise.all([
    getSessionSnapshot(scope),
    cookies(),
  ]);

  /*
   * NO VIEWER SPLITS TWO WAYS, and conflating them was a real bug: with the API
   * down every render fell through to the redirect, so a signed-in person was
   * sent to a sign-in page that could not sign them in either. The outage was
   * reported as a sign-out, which is the one explanation that makes it look
   * like the reader's own fault.
   */
  /*
   * ── WHICH ORGANIZATION THE DRAWER IS SHOWING ──────────────────────────────
   *
   * The URL when the page is a tenant's own, otherwise the remembered
   * selection — so the section survives a trip to the dashboard or an admin
   * screen, which is what a switcher implies. A cookie value naming an
   * organization the viewer is not in is refused; see
   * `resolveActiveOrganization`.
   *
   * ⚠ This is the DRAWER's scope and never the page's. `scope` below is still
   * the URL's, and it is what authorised this render and what the permissions
   * provider carries.
   */
  const activeOrganizationId = resolveActiveOrganization(
    scope.organizationId,
    cookieStore.get(ACTIVE_ORGANIZATION_COOKIE)?.value,
    organizations,
  );

  /*
   * ── WHAT THE DRAWER NEEDS, AT BOTH LEVELS AT ONCE ─────────────────────────
   *
   * One request when an organization is selected, none when it is not.
   *
   * `/admin/*` resolves at APP level and the tenant section at ORGANIZATION
   * level, and filtering both with one context gets one of them wrong: an
   * organization admin holding `roles:read` — an organization-level key that
   * ALSO gates `/admin/roles` — would be offered the platform's roles screen
   * and refused by it on arrival. So both readings are asked for together,
   * under aliases, along with the workspaces the selector lists.
   *
   * ⚠ None of it reaches `<PermissionsProvider>`. That carries the PAGE's own
   * context, resolved at the URL's scope, because every `<FeatureGate>` below
   * reads it — see `getNavContext`.
   */
  const nav = activeOrganizationId
    ? await getNavContext(
        activeOrganizationId,
        scope.workspaceId ?? cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value ?? null,
      )
    : undefined;

  /*
   * With nothing selected the page is necessarily app level — an organization
   * in the URL IS a selection — so its own context is the app-level reading
   * and there is nothing extra to fetch.
   */
  const appGrants = nav ? nav.appGranted : permissions?.granted;
  const organizationGrants = nav?.organizationGranted;
  const workspaces = nav?.workspaces ?? [];

  /*
   * ── THE SELECTORS MUST REFLECT THE URL ────────────────────────────────────
   *
   * The id already does — the URL beats the cookie in `resolveActiveOrganization`
   * — but NAMING it goes through the viewer's own organizations, and platform
   * staff drill into customers they hold no membership in. There the switcher
   * fell back to the product name while the page beside it showed that
   * customer's data: the header contradicting the content.
   *
   * Fetched only on that path, because for a member the name is already in
   * hand. Null when they have no standing there either, which is honest — the
   * page refuses them too.
   */
  const activeOrganizationIsOwn = organizations.some(
    (organization) => organization.organizationId === activeOrganizationId,
  );
  const [visitingOrganization, visitingPlan] =
    activeOrganizationId && !activeOrganizationIsOwn
      ? /*
         * Both on the SAME rare path, and awaited together.
         *
         * The plan comes with `myOrganizations` for everybody who is a MEMBER
         * of the tenant, so this second read exists only for staff standing in
         * a customer they do not belong to — the same people `getOrganizationIdentity`
         * exists for. ⚠ It is a request of its own rather than a field on the
         * drawer's query because `myOrganizationSubscriptions` is non-null in
         * the schema and guarded by `subscriptions:read`: a refusal would null
         * the field, and a null on a non-null field propagates to `data`, which
         * would have emptied the whole drawer instead of hiding one icon.
         */
        await Promise.all([getOrganizationIdentity(activeOrganizationId), getOrganizationPlan(activeOrganizationId)])
      : [null, null];

  /*
   * The selected workspace, validated against the workspaces of the SELECTED
   * organization that this viewer may enter.
   *
   * That validation is what makes "changing organization unselects the
   * workspace" true without anything having to clear a cookie: a workspace
   * remembered from another tenant is not in this list. It covers the cases a
   * cleanup step would have missed too — a workspace the viewer was removed
   * from, and one that has since been archived.
   */
  const activeWorkspaceId = resolveActiveWorkspace(
    scope.workspaceId,
    cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value,
    workspaces,
  );

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
        Renders nothing as well. Remembers the organization the URL names, so
        the drawer's tenant section survives navigating away from it.

        Fed the URL's organization and NOT `activeOrganizationId`: writing back
        the value that was just read from the cookie would refresh its expiry on
        every page in the app, and the thing worth recording is a reader
        actually going somewhere, not staying put.

        Null unless the tenant is one of the viewer's own — platform staff open
        customers they do not belong to, and remembering one would pin a company
        they hold nothing in to the top of their drawer.
      */}
        <RememberOrganization
          organizationId={
            organizations.some((organization) => organization.organizationId === scope.organizationId)
              ? (scope.organizationId ?? null)
              : null
          }
          /*
           * Already validated: `activeWorkspaceId` is null unless the URL or
           * the cookie named a workspace this viewer may enter in the selected
           * organization. Only a URL visit is worth recording, hence the
           * check against the URL's own id — arriving somewhere is a choice,
           * staying put is not.
           */
          workspaceId={scope.workspaceId && activeWorkspaceId === scope.workspaceId ? scope.workspaceId : null}
        />
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
            /*
             * The scope goes to the nav builder as well as to the query.
             *
             * A route like `/organizations/:organizationId/members` is not a
             * URL until that parameter has a value, so `composeNav` drops it
             * when there is none — which is what makes the drawer drill into a
             * tenant and back out of one without anything having to declare
             * that it switches.
             *
             * The organization's NAME does not come along: the section is
             * headed by the static word "Organization", because the switcher
             * directly above already names the tenant and saying it twice in
             * two rows adds nothing.
             */
            groups={buildNav({
              app: appGrants,
              organization: organizationGrants,
              /*
               * Undefined unless a workspace is actually selected, so the
               * section is skipped rather than composed and then emptied. The
               * grants come from a WORKSPACE-scoped reading — an
               * organization-scoped one carries no workspace-level keys, so the
               * next page added to that section would be hidden from the people
               * who hold the right to it.
               */
              workspace: activeWorkspaceId ? nav?.workspaceGranted : undefined,
              params: {
                organizationId: activeOrganizationId ?? undefined,
                workspaceId: activeWorkspaceId ?? undefined,
              },
            })}
            defaultCollapsed={isCollapsedValue(cookieStore.get(SIDEBAR_COOKIE)?.value)}
            brand={appBrand()}
            /*
             * Plain data, like `groups` — the drawer is a client component and
             * these cross the boundary. The switcher needs the whole list
             * because its job is reaching the organizations you are NOT in.
             */
            organizations={organizations.map((organization) => ({
              id: organization.organizationId,
              key: organization.organizationKey,
              name: organization.organizationName,
              roleLabel: organization.roleLabel,
              roleIcon: organization.roleIcon,
              /*
               * The plan of EACH organization, not only the selected one — the
               * menu is where somebody chooses between tenants, and "which of
               * these is on Enterprise" was a question the list could not
               * answer. It arrives with `myOrganizations`, so the rows cost no
               * extra request.
               */
              planLabel: organization.planLabel,
              planKey: organization.planKey,
              planIcon: organization.planIcon,
            }))}
            activeOrganizationId={activeOrganizationId}
            /*
             * What the plan's hover card says beyond its name.
             *
             * `entitled` comes from the ORGANIZATION-scoped reading, because
             * that is the only one that answers "what did THIS tenant buy" —
             * the app-level context carries no entitlement for a customer at
             * all. ⚠ Null is carried through rather than defaulted: it means
             * the deployment has no entitlement model, which the card must not
             * report as "includes 0".
             */
            organizationPlanDetail={
              activeOrganizationId
                ? {
                    entitlements: nav?.organizationEntitled?.length ?? null,
                    canReadSubscription: organizationGrants?.includes(FEATURE.subscriptionsRead) ?? false,
                  }
                : null
            }
            /*
             * Only ever set for a tenant the viewer is not a member of. The
             * switcher uses it to LABEL the selection and says plainly that
             * they hold nothing there; it is not added to the list, which is
             * "the organizations you belong to".
             */
            activeOrganizationFallback={
              visitingOrganization
                ? {
                    id: visitingOrganization.id,
                    key: visitingOrganization.key,
                    name: visitingOrganization.name,
                    // No role, and none to draw: they hold nothing here, which
                    // is what the switcher says instead.
                    roleLabel: null,
                    roleIcon: null,
                    /*
                     * The plan still shows, when they may read it. This is the
                     * one place null genuinely means two things — the tenant is
                     * on no plan, or `subscriptions:read` refused — and the
                     * switcher deliberately draws nothing either way rather
                     * than asserting "No plan" at somebody who was refused.
                     */
                    planLabel: visitingPlan?.planLabel ?? null,
                    planKey: visitingPlan?.planKey ?? null,
                    planIcon: visitingPlan?.planIcon ?? null,
                  }
                : null
            }
            /*
             * The workspaces of the selected organization that this viewer may
             * ENTER — their own `accessibleWorkspaceIds`, resolved to names.
             * Empty when no organization is selected, which is what leaves the
             * selector disabled rather than open onto an empty list.
             */
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            /*
             * Whether the selector offers "New workspace".
             *
             * Read from the ORGANIZATION-scoped grants, which is the reading
             * the create page itself resolves at — `workspaces:create` is an
             * organization-level key, because which workspaces a tenant has is
             * the tenant's decision and not a workspace's about itself. The
             * app-level reading carries no such key, so filtering on `appGrants`
             * here would hide the item from everybody who holds it.
             *
             * `?? false` for the same reason the nav filter fails closed: an
             * unresolved context means "holds nothing", never "assume the
             * usual". Undefined is also the no-organization case, where the
             * selector is disabled and the menu cannot open anyway.
             */
            canCreateWorkspace={organizationGrants?.includes(FEATURE.workspacesCreate) ?? false}
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
              /*
               * APP-level grants, like the rest of the drawer's unscoped half.
               * The account entries carry no feature key today, so this changes
               * nothing — but looking after your own account is a fact about
               * the person and not about a tenant, so the day one of them does
               * take a key it must not be filtered by whichever organization
               * happens to be selected.
               */
              accountNav={buildAccountNav(appGrants)}
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
