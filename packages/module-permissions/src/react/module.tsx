import type { ModuleRouteProps, WebModuleDescriptor } from '@kwtech/module-kit';
import { FEATURE, FEATURE_REGISTRY } from '../feature-keys.js';
import { DefaultsPage } from './pages/defaults-page.js';
import { FeatureEditPage } from './pages/feature-edit-page.js';
import { FeatureImportPage } from './pages/feature-import-page.js';
import { FeatureNewPage } from './pages/feature-new-page.js';
import { FeaturesPage } from './pages/features-page.js';
import { InviteUserPage } from './pages/invite-user-page.js';
import { MyOrganizationsPage } from './pages/my-organizations-page.js';
import { OrganizationDetailPage } from './pages/organization-detail-page.js';
import { OrganizationHomePage } from './pages/organization-home-page.js';
import { OrganizationMembersPage } from './pages/organization-members-page.js';
import { OrganizationNewPage } from './pages/organization-new-page.js';
import { OrganizationSettingsPage } from './pages/organization-settings-page.js';
import { OrganizationSubscriptionPage } from './pages/organization-subscription-page.js';
import { OrganizationWorkspacePage } from './pages/organization-workspace-page.js';
import { OrganizationWorkspaceSettingsPage } from './pages/organization-workspace-settings-page.js';
import { OrganizationWorkspacesPage } from './pages/organization-workspaces-page.js';
import { OrganizationsPage } from './pages/organizations-page.js';
import { PlanEditPage } from './pages/plan-edit-page.js';
import { PlanNewPage } from './pages/plan-new-page.js';
import { PlansPage } from './pages/plans-page.js';
import { RoleEditPage } from './pages/role-edit-page.js';
import { RoleNewPage } from './pages/role-new-page.js';
import { RolesPage } from './pages/roles-page.js';
import { SubscriptionEditPage } from './pages/subscription-edit-page.js';
import { SubscriptionNewPage } from './pages/subscription-new-page.js';
import { SubscriptionsPage } from './pages/subscriptions-page.js';
import { WorkspaceDetailPage } from './pages/workspace-detail-page.js';
import { WorkspaceNewPage } from './pages/workspace-new-page.js';
import { ORGANIZATION_NAV_GROUP, ORGANIZATIONS_HREF, WORKSPACE_NAV_GROUP } from './tenant-nav.js';

/**
 * The module's web descriptor — routes, navigation and feature contributions as
 * data, so the app composes rather than transcribes.
 *
 *   const WEB_MODULES = [permissionsWebModule, usersWebModule];
 *
 * From that one list the app derives its navigation, its middleware protection
 * and its rendered routes. Nothing here is permissions-specific machinery:
 * every module-* package exports exactly this shape.
 */

/*
 * ── route adapters ──────────────────────────────────────────────────────────
 *
 * ⚠ These must render JSX, never CALL the page.
 *
 * `RolesPage({})` looks equivalent and is not: the pages are `'use client'`,
 * and across that boundary Next replaces the module with a client-reference
 * proxy. Invoking one from a server component throws "Attempted to call
 * RolesPage() from the server but RolesPage is on the client" — it can only be
 * RENDERED. That is the whole reason this file is `.tsx` rather than `.ts`,
 * and the same reason `module-auth`'s descriptor is.
 *
 * A `ModuleRoute` component is handed `params` and `searchParams` and nothing
 * else, so the pages' richer props are supplied here — the same arrangement
 * `module-auth` uses for its settings routes. The pages stay renderable, and
 * testable, outside a router: an app that wants to pass its own client or its
 * own icon set imports the page directly.
 */
function DefaultsRoute(_props: ModuleRouteProps) {
  return <DefaultsPage />;
}

function RolesRoute(_props: ModuleRouteProps) {
  return <RolesPage />;
}

function RoleNewRoute(_props: ModuleRouteProps) {
  return <RoleNewPage />;
}

function RoleEditRoute({ params }: ModuleRouteProps) {
  // The dynamic segment declared on the route below. `matchRouteWithParams`
  // populates it; a direct import passes it by hand.
  return <RoleEditPage roleId={params?.roleId} />;
}

function OrganizationsRoute(_props: ModuleRouteProps) {
  return <OrganizationsPage />;
}

function OrganizationNewRoute(_props: ModuleRouteProps) {
  return <OrganizationNewPage />;
}

function OrganizationDetailRoute({ params }: ModuleRouteProps) {
  return <OrganizationDetailPage organizationId={params?.organizationId} />;
}

function WorkspaceDetailRoute({ params }: ModuleRouteProps) {
  return <WorkspaceDetailPage organizationId={params?.organizationId} workspaceId={params?.workspaceId} />;
}

function PlansRoute(_props: ModuleRouteProps) {
  return <PlansPage />;
}

function PlanNewRoute(_props: ModuleRouteProps) {
  return <PlanNewPage />;
}

function PlanEditRoute({ params }: ModuleRouteProps) {
  return <PlanEditPage planKey={params?.planKey} />;
}

function SubscriptionsRoute(_props: ModuleRouteProps) {
  return <SubscriptionsPage />;
}

function SubscriptionNewRoute(_props: ModuleRouteProps) {
  return <SubscriptionNewPage />;
}

function SubscriptionEditRoute({ params }: ModuleRouteProps) {
  return <SubscriptionEditPage subscriptionId={params?.subscriptionId} />;
}

function InviteUserRoute(): React.JSX.Element {
  return <InviteUserPage />;
}

/*
 * ── the tenant's own area ────────────────────────────────────────────────────
 *
 * `/organizations/*`, as opposed to `/admin/organizations/*` above. The paths
 * are not a naming preference: `/organizations/:orgId/...` is the CONVENTION
 * `scope.ts` parses, so a request from one of these screens resolves at
 * organization or workspace level and a customer's own role participates. The
 * `/admin` twins resolve at app level and answer only to platform staff.
 *
 * That is PLAN §12.13, and it is why the workspace screen exists twice rather
 * than being linked to from both places: the two paths mean different things to
 * the guard, and one component behind both would resolve at whichever level the
 * reader happened to arrive by.
 */
function MyOrganizationsRoute(_props: ModuleRouteProps) {
  return <MyOrganizationsPage />;
}

function MyOrganizationNewRoute(_props: ModuleRouteProps) {
  /*
   * The SAME page as `/admin/organizations/new`, pointed at the tenant list.
   * Creating an organization is one act with one write behind it — the screen
   * has nothing platform-specific in it, and a second copy would be a second
   * place for the `user:organizations` cap to be explained differently.
   */
  /*
   * `basePath` is a STRING, and that is load-bearing rather than tidy: this
   * adapter renders on the server and `OrganizationNewPage` is `'use client'`,
   * so a function prop cannot cross the boundary — it 500s with "Functions
   * cannot be passed directly to Client Components". The page used to take a
   * `detailHref` callback and this route is what found it.
   */
  return <OrganizationNewPage basePath={ORGANIZATIONS_HREF} />;
}

function OrganizationHomeRoute({ params }: ModuleRouteProps) {
  return <OrganizationHomePage organizationId={params?.organizationId} />;
}

function OrganizationMembersRoute({ params }: ModuleRouteProps) {
  return <OrganizationMembersPage organizationId={params?.organizationId} />;
}

function OrganizationWorkspacesRoute({ params }: ModuleRouteProps) {
  return <OrganizationWorkspacesPage organizationId={params?.organizationId} />;
}

function OrganizationWorkspaceNewRoute({ params }: ModuleRouteProps) {
  return <WorkspaceNewPage organizationId={params?.organizationId} />;
}

function OrganizationWorkspaceRoute({ params }: ModuleRouteProps) {
  return <OrganizationWorkspacePage organizationId={params?.organizationId} workspaceId={params?.workspaceId} />;
}

function OrganizationWorkspaceSettingsRoute({ params }: ModuleRouteProps) {
  return (
    <OrganizationWorkspaceSettingsPage organizationId={params?.organizationId} workspaceId={params?.workspaceId} />
  );
}

function OrganizationSubscriptionRoute({ params }: ModuleRouteProps) {
  return <OrganizationSubscriptionPage organizationId={params?.organizationId} />;
}

function OrganizationSettingsRoute({ params }: ModuleRouteProps) {
  return <OrganizationSettingsPage organizationId={params?.organizationId} />;
}

export const permissionsWebModule: WebModuleDescriptor = {
  key: 'permissions',
  features: FEATURE_REGISTRY,
  /*
   * Where 'Administration' belongs, declared HERE rather than in the app.
   *
   * The app used to keep a hand-written GROUP_ORDER array, so adopting a module
   * meant editing it — and forgetting silently dropped that module's group to
   * the bottom of the drawer. Declared on the descriptor, adopting this module
   * is a single line in the app's WEB_MODULES and nothing else.
   *
   * 50 leaves room either side: the app's own 'Overview' sits above at 10 and
   * 'Account' below at 90, and a module that belongs between any two of them
   * has numbers to use.
   */
  /*
   * THREE groups, and the order between them is the model showing through.
   *
   *   Organization   20  the tenant you have selected. Only there when you have.
   *   Workspace      30  the workspace inside it. Only there when one is selected.
   *   Administration 50  the platform's back office.
   *
   * Organization then Workspace is the containment, and it matches the two
   * selectors at the top of the drawer: you are in a tenant, and inside that a
   * workspace. Neither section is a list of the other's contents — each holds
   * the pages scoped to that level, which is the same split the URL makes.
   *
   * The tenant group sits above Administration because that is where an
   * ordinary user lives, and the back office is where a handful of staff visit.
   * Somebody who holds both sees their own company first.
   *
   * ## The heading is the STATIC word, not the tenant's name
   *
   * It briefly drew the organization's name, and that was worse: the switcher
   * sits at the top of the drawer and already says which organization you are
   * in, so the name appeared twice within two rows. A static word beside a live
   * name reads as a label for it, which is what a section heading is for.
   *
   * ## There is no group for `/organizations` itself
   *
   * Switching organization is the SWITCHER's job, at the top of the drawer,
   * where it also offers "All organizations" and "New organization". A drawer
   * entry beside it would be a second control for one act, and the two would
   * drift. The route still exists and is still reachable — it simply declares
   * no `nav`, exactly as the write screens do.
   *
   * ## The section appears and disappears by ARITHMETIC, not by a mode
   *
   * Every route in it carries a `:organizationId`, and `composeNav` drops an
   * entry whose parameters it cannot fill. So the drawer drills in and back out
   * without anything having to declare that it switches — and a route added
   * here later gets that behaviour just by having the parameter in its path.
   */
  navGroups: [
    { group: ORGANIZATION_NAV_GROUP, order: 20 },
    /*
     * Directly below the organization's, because that is the containment: you
     * are in a tenant, and inside that a workspace. The two selectors at the
     * top of the drawer read the same way round.
     */
    { group: WORKSPACE_NAV_GROUP, order: 30 },
    { group: 'Administration', order: 50 },
  ],
  /*
   * Ordered so the drawer reads as two pairs rather than four items: access
   * control first — the vocabulary, then the roles assembled from it — and then
   * commercial state, what each tenant bought and who they are.
   *
   * Every entry names a DIFFERENT key. That is the point of declaring them
   * here: someone who can manage members but not billing sees Organizations and
   * not Subscriptions, and the filtering happens once, in composeNav, rather
   * than in each page discovering it is not allowed after the reader clicked.
   */
  routes: [
    /*
     * ── the tenant's own area, `/organizations/*` ──────────────────────────
     *
     * Declared FIRST because it is the area most people will be in, and because
     * reading it before `/admin/*` makes the pairing obvious: nearly every
     * screen here has an `/admin` twin that answers the same question about any
     * tenant instead of about this one.
     *
     * The literal `/organizations/new` is declared before `/organizations/:id`
     * for reading order only — `matchRouteWithParams` scores literal segments
     * above dynamic ones, so it would win either way, and module-kit's tests
     * assert that.
     */
    {
      path: '/organizations',
      component: MyOrganizationsRoute,
      title: 'Organizations',
      /*
       * NO FEATURE, and that is the one thing on this route worth arguing
       * about. Every other screen in this area takes `organization:read`, an
       * ORGANIZATION-level key — which you hold inside a tenant, granted by a
       * role there. Somebody who belongs nowhere holds nothing anywhere, and
       * they are exactly the person who needs this page: to find the
       * organization an invitation put them in, or to create their first.
       *
       * A key here would be a key you need before you can be given any key.
       *
       * It discloses nothing either way — `myOrganizations` answers about the
       * caller, from the session rather than from an argument.
       *
       * Listed in the drawer for the same reason, with no `:params` in its
       * path, so it is the one entry in this area that is always there.
       */
      /*
       * UNLISTED — no `nav` at all, and this is the one route where that is
       * worth explaining rather than assuming.
       *
       * It is the only route in this area with no `:organizationId`, so it is
       * the only one that COULD sit in the drawer permanently. It does not,
       * because switching organization is the switcher's job: it sits at the
       * top of the drawer, names the organization you are in, and lists every
       * other one plus "All organizations" and "New organization". A drawer
       * entry beside it would be a second control for one act.
       *
       * Reachable all the same — from the switcher, from the tenant screens'
       * back links, and by typing it.
       */
    },
    {
      path: '/organizations/new',
      component: MyOrganizationNewRoute,
      title: 'New organization',
      /*
       * Also unkeyed. `createOrganization` is bounded by the
       * `user:organizations` LIMIT rather than by a feature — there is no
       * organization yet to grant the right — so there is nothing to gate on
       * and the cap does the refusing at the write. The `/admin` twin takes
       * `organizations:read` because it lives in an area that has one; this
       * area does not.
       */
    },
    {
      path: '/organizations/:organizationId',
      component: OrganizationHomeRoute,
      title: 'Overview',
      feature: FEATURE.organizationRead,
      nav: { group: ORGANIZATION_NAV_GROUP, order: 20, icon: 'dashboard' },
    },
    {
      path: '/organizations/:organizationId/members',
      component: OrganizationMembersRoute,
      title: 'Members',
      /*
       * `members:manage`, not `organization:read`: this screen IS the member
       * administration, and every control on it writes. Somebody who may open
       * the organization and not administer it sees the overview's counts and
       * no Members entry at all — which is the split working, not a gap.
       */
      feature: FEATURE.membersRead,
      nav: { group: ORGANIZATION_NAV_GROUP, order: 30, icon: 'users' },
    },
    {
      path: '/organizations/:organizationId/workspaces',
      component: OrganizationWorkspacesRoute,
      title: 'Workspaces',
      feature: FEATURE.workspacesRead,
      /*
       * UNLISTED. Entering a workspace is the SELECTOR's job — it sits under
       * the organization switcher, lists the workspaces this reader may
       * actually enter, and opens one. A drawer entry beside it would be a
       * second route to the same place, and the two would drift.
       *
       * This screen is not that place anyway: it is where workspaces are
       * CREATED, renamed and archived, which is administering the organization
       * rather than working in a workspace. Reached from the Workspaces card on
       * the organization's overview, which is where somebody is when they want
       * it.
       */
    },
    {
      /*
       * UNLISTED, and reached from the WORKSPACE SELECTOR — its "New workspace"
       * item, the mirror of the organization switcher's "New organization".
       * The workspaces grid keeps its own inline row: that one is for somebody
       * already administering the list, this is for somebody who is not on that
       * screen and may not know it exists.
       *
       * ⚠ Declared BEFORE `/organizations/:organizationId/workspaces/:workspaceId`
       * for reading order only — `matchRouteWithParams` scores literal segments
       * above dynamic ones, so it would win either way, and module-kit's tests
       * assert that. What the match decides here is the LEVEL: the literal
       * captures no `:workspaceId`, so the app's catch-all resolves this at
       * ORGANIZATION level, which is where `workspaces:create` lives. Left to
       * `parseScope` alone the trailing `new` would read as a workspace id —
       * the same collision `/organizations/new` has, pinned by the same test.
       */
      path: '/organizations/:organizationId/workspaces/new',
      component: OrganizationWorkspaceNewRoute,
      title: 'New workspace',
      /*
       * KEYED, unlike `/organizations/new`. That one is unkeyed because there
       * is no organization yet to grant the right to create one; here there
       * is, and `workspaces:create` is the organization-level key the mutation
       * itself is guarded by. Somebody without it never sees the selector's
       * item and is refused by the page if they type the URL.
       */
      feature: FEATURE.workspacesCreate,
    },
    {
      /*
       * UNLISTED — reached from the workspaces grid, which is where somebody is
       * when they want one. It could not be listed anyway: its path carries a
       * second parameter the drawer has no value for.
       *
       * ⚠ This is the first WORKSPACE-level route in the codebase. `myWorkspace`
       * declares `@RequireScope('workspace')`, so the guard runs
       * `canAccessWorkspace` before answering — §12.33 enforced rather than
       * described. `organization:read` gates the page; the controls inside take
       * `workspaces:manage` and `workspaces:share`.
       */
      path: '/organizations/:organizationId/workspaces/:workspaceId',
      component: OrganizationWorkspaceRoute,
      /*
       * 'Overview' — and it is one now, which it was not when this label was
       * first written. The single page held a rename form, the member list and
       * an archive control, so the name promised a landing page that did not
       * exist; the editing moved to Settings below and this kept what an
       * overview is for: what the workspace is, and who is in it.
       *
       * The page is headed by the workspace's NAME, which is the thing worth
       * reading there; this label is the drawer's and the header's.
       */
      title: 'Overview',
      feature: FEATURE.organizationRead,
      nav: { group: WORKSPACE_NAV_GROUP, order: 10, icon: 'workspace' },
    },
    {
      /*
       * The workspace's own Settings, mirroring the organization's — rename,
       * description and archive, with the member list deliberately left on the
       * Overview. Members are not settings.
       *
       * Gated on `organization:read` like the Overview, with
       * `workspaces:manage` on the controls INSIDE, so following a bookmark
       * here without it shows what the workspace is called rather than a
       * denial. The Overview only OFFERS this page to somebody who holds it.
       */
      path: '/organizations/:organizationId/workspaces/:workspaceId/settings',
      component: OrganizationWorkspaceSettingsRoute,
      title: 'Settings',
      feature: FEATURE.organizationRead,
      nav: { group: WORKSPACE_NAV_GROUP, order: 20, icon: 'settings' },
    },
    {
      path: '/organizations/:organizationId/subscription',
      component: OrganizationSubscriptionRoute,
      title: 'Subscription',
      // Already an ORGANIZATION-level key, and has been since it was written —
      // it simply had no organization-scoped surface to be useful on.
      feature: FEATURE.subscriptionsRead,
      nav: { group: ORGANIZATION_NAV_GROUP, order: 50, icon: 'billing' },
    },
    {
      path: '/organizations/:organizationId/settings',
      component: OrganizationSettingsRoute,
      title: 'Settings',
      /*
       * `organization:read`, not `organization:manage` — because LEAVING lives
       * on this page, and leaving is not a right an administrator grants. The
       * rename form inside is gated on `organization:manage` separately.
       */
      feature: FEATURE.organizationRead,
      nav: { group: ORGANIZATION_NAV_GROUP, order: 60, icon: 'settings' },
    },

    // ── the platform's back office, `/admin/*` ─────────────────────────────
    {
      path: '/admin/roles',
      component: RolesRoute,
      title: 'Roles',
      // The same key gates the nav entry, the middleware and the page body —
      // one declaration, so a link can never outlive the permission behind it.
      //
      // `roles:read`, not `admin:access`: reading the roles that exist is its
      // own right, for the reason the Features page took `features:read`. Two
      // keys claiming one route is a contradiction the registry audit refuses
      // — and it refused this one, which is how the change was found.
      feature: FEATURE.rolesRead,
      nav: { group: 'Administration', order: 20, icon: 'shield' },
    },
    /*
     * The role write screens, UNLISTED — reached from the toolbar on the list,
     * which is where somebody is when they want them. One key each, so a role
     * can hold create without update.
     *
     * The literal path is declared before the dynamic one for reading order
     * only; `matchRouteWithParams` scores literal segments above dynamic ones.
     */
    {
      path: '/admin/roles/new',
      component: RoleNewRoute,
      title: 'New role',
      feature: FEATURE.rolesCreate,
    },
    {
      path: '/admin/roles/:roleId/edit',
      component: RoleEditRoute,
      title: 'Edit role',
      feature: FEATURE.rolesUpdate,
    },
    {
      path: '/admin/features',
      component: FeaturesPage,
      title: 'Features',
      /*
       * Its own key, not `roles:manage`. Reading the vocabulary and defining
       * roles from it are separate rights: a reviewer may need to see what
       * exists without being able to hand any of it out.
       */
      feature: FEATURE.featuresRead,
      nav: { group: 'Administration', order: 10, icon: 'key' },
    },
    /*
     * The three write screens, all UNLISTED — no `nav`, so they are reachable
     * but do not clutter a drawer that would otherwise show four Features
     * entries. They are reached from the toolbar on the list, which is where
     * someone is when they want them.
     *
     * ONE KEY EACH, which is what lets a role hold some of them and not others
     * — "may add features by hand, may not bulk-import" is expressible, and so
     * is "may create, may not change what an existing key means". None is
     * implied by another: no inheritance, so a role means exactly the list it
     * carries.
     *
     * All three are app level, so an organization-level role cannot carry any
     * of them.
     *
     * The literal paths are declared BEFORE the dynamic one only for reading
     * order; `matchRouteWithParams` scores literal segments above dynamic ones,
     * so '/admin/features/new/manual' beats '/admin/features/:featureId/edit'
     * whatever order they appear in. That is asserted in module-kit's tests.
     */
    {
      path: '/admin/features/new/manual',
      component: FeatureNewPage,
      title: 'New feature',
      feature: FEATURE.featuresCreate,
    },
    {
      path: '/admin/features/new/import',
      component: FeatureImportPage,
      title: 'Import features',
      feature: FEATURE.featuresImport,
    },
    {
      path: '/admin/features/:featureId/edit',
      component: FeatureEditPage,
      title: 'Edit feature',
      feature: FEATURE.featuresUpdate,
    },
    {
      path: '/admin/organizations',
      component: OrganizationsRoute,
      title: 'Organizations',
      /*
       * `organizations:read`, not `members:manage`. Reading which tenants exist
       * is APP level — it spans every organization — while managing members is
       * organization level and gates the controls INSIDE the detail screen.
       * Two rights, two places, which is what lets support look without being
       * able to change anything.
       */
      feature: FEATURE.organizationsRead,
      nav: { group: 'Administration', order: 40, icon: 'organization' },
    },
    /*
     * Both UNLISTED, reached from the list. The literal path is declared before
     * the dynamic one for reading order only; `matchRouteWithParams` scores
     * literal segments above dynamic ones.
     */
    {
      path: '/admin/organizations/new',
      component: OrganizationNewRoute,
      title: 'New organization',
      // The same key as the list: `createOrganization` is bounded by the
      // `user:organizations` LIMIT rather than by a feature, so there is no
      // create key to name here. See the page.
      feature: FEATURE.organizationsRead,
    },
    {
      path: '/admin/organizations/:organizationId',
      component: OrganizationDetailRoute,
      title: 'Organization',
      feature: FEATURE.organizationsRead,
    },
    /*
     * One workspace. Under `/admin`, mirroring the screen it descends from —
     * the bare `/organizations/:orgId/workspaces/:workspaceId` is the scope
     * convention `scope.ts` parses, and a route there would resolve at
     * WORKSPACE level rather than app level. That route now exists, at the top
     * of this list, and it is a DIFFERENT screen for a different audience —
     * these are platform-staff screens, and the two must not be merged, because
     * merging them would resolve at whichever level the reader arrived by.
     *
     * `organizations:read` gates the page; the controls inside take
     * `workspaces:manage` and `workspaces:share`, so somebody may look at a
     * workspace and change nothing in it.
     */
    {
      path: '/admin/organizations/:organizationId/workspaces/:workspaceId',
      component: WorkspaceDetailRoute,
      title: 'Workspace',
      feature: FEATURE.organizationsRead,
    },
    /*
     * ── the entitlement pair ────────────────────────────────────────────────
     *
     * Plans then Subscriptions, in that order and adjacent, because that is the
     * order of the two questions: what does the platform sell, and who is on
     * it. A subscription is a pointer at a plan, so a reader who meets
     * Subscriptions first meets a screen full of names they have not been
     * introduced to.
     *
     * They take DIFFERENT keys — `plans:read` and `subscriptions:read` — which
     * is the point of declaring nav here: somebody who may see the catalogue
     * but not who is on what gets one entry and not the other, and the
     * filtering happens once, in composeNav, rather than in each page
     * discovering it is not allowed after the reader clicked.
     */
    {
      /*
       * NOT under `/admin/users`, which `module-auth` owns. Routes compose in
       * module order and its `/admin/users/:userId` is declared first, so a
       * literal `/admin/users/invite` here would be swallowed by that dynamic
       * segment and read as a user whose id is "invite". The Users list links
       * here by path instead — a string, not an import.
       */
      path: '/admin/invitations/new',
      component: InviteUserRoute,
      title: 'Invite a user',
      // The app-role key, because the app-level role is the field this screen
      // exists for. The organization half is checked against the actor inside
      // `inviteUser`, so an administrator without `members:manage` can still
      // invite to the platform.
      feature: FEATURE.rolesGrantApp,
    },
    {
      /*
       * WHAT THE PLATFORM DOES BY DEFAULT — the policy behind three creation
       * paths, in one place.
       *
       * Listed LAST in the Administration group (order 90). It is the screen
       * somebody visits least often and the one whose settings apply most
       * widely, and putting it above Roles would offer a policy screen to
       * somebody who has not yet met the roles it points at.
       *
       * `defaults:read`, not `defaults:manage`: working out why a customer's
       * founder holds nothing is a support question, and the page gates only
       * its INPUTS on the write key. A route keyed on manage would hide the
       * answer from everybody who may not change it.
       */
      path: '/admin/defaults',
      component: DefaultsRoute,
      title: 'Defaults',
      feature: FEATURE.defaultsRead,
      nav: { group: 'Administration', order: 90, icon: 'settings' },
    },
    {
      path: '/admin/plans',
      component: PlansRoute,
      title: 'Plans',
      // `plans:read`, not `billing:manage`: reading the catalogue is its own
      // right, for the reason the Roles page took `roles:read`. Two keys
      // claiming one route is a contradiction the registry audit refuses.
      feature: FEATURE.plansRead,
      nav: { group: 'Administration', order: 25, icon: 'plan' },
    },
    /*
     * The plan write screens, UNLISTED — reached from the toolbar on the list.
     * One key each, so a role can hold create without update; both are app
     * level, so no organization-level role can carry either.
     *
     * The literal path is declared before the dynamic one for reading order
     * only; `matchRouteWithParams` scores literal segments above dynamic ones.
     */
    {
      path: '/admin/plans/new',
      component: PlanNewRoute,
      title: 'New plan',
      feature: FEATURE.plansCreate,
    },
    {
      path: '/admin/plans/:planKey/edit',
      component: PlanEditRoute,
      title: 'Edit plan',
      feature: FEATURE.plansUpdate,
    },
    {
      path: '/admin/subscriptions',
      component: SubscriptionsRoute,
      title: 'Subscriptions',
      // Reading who is on what, which support needs to answer "why can they not
      // do this" without being able to change anybody's entitlement. The write
      // screens below take `billing:manage`.
      feature: FEATURE.subscriptionsRead,
      nav: { group: 'Administration', order: 30, icon: 'billing' },
    },
    {
      path: '/admin/subscriptions/new',
      component: SubscriptionNewRoute,
      title: 'New subscription',
      feature: FEATURE.billingManage,
    },
    {
      path: '/admin/subscriptions/:subscriptionId/edit',
      component: SubscriptionEditRoute,
      title: 'Edit subscription',
      feature: FEATURE.billingManage,
    },
  ],
};
