import type { ModuleRouteProps, WebModuleDescriptor } from '@kwtech/module-kit';
import { FEATURE, FEATURE_REGISTRY } from '../feature-keys.js';
import { FeatureEditPage } from './pages/feature-edit-page.js';
import { FeatureImportPage } from './pages/feature-import-page.js';
import { FeatureNewPage } from './pages/feature-new-page.js';
import { FeaturesPage } from './pages/features-page.js';
import { InviteUserPage } from './pages/invite-user-page.js';
import { OrganizationDetailPage } from './pages/organization-detail-page.js';
import { OrganizationNewPage } from './pages/organization-new-page.js';
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
  navGroups: [{ group: 'Administration', order: 50 }],
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
     * WORKSPACE level rather than app level. That is the tenant-facing area
     * PLAN §12.13 still defers, and these are platform-staff screens.
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
