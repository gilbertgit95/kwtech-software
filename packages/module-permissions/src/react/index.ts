/**
 * @kwtech/module-permissions/react — the browser adapter.
 *
 * react is an optional peer, so a server app importing only the core or the
 * nest subpath never pulls it in.
 *
 * ⚠ NAMED re-exports, never `export *`.
 *
 * Half of this barrel is `'use client'`. A Next.js app replaces such a module
 * with a client-reference proxy, and `export *` compiles to TypeScript's
 * `__exportStar`, which copies keys with `for...in` — an enumeration that
 * proxy does not answer. The re-export then yields NOTHING, and the failure
 * arrives as "Element type is invalid: ... got: undefined" at render, pointing
 * nowhere near this file. Named re-exports compile to property getters
 * instead, which read straight through the proxy.
 *
 * The same hazard applies to any module-* package whose barrel mixes client
 * components with server-side data like a descriptor.
 */

export { denialMessage, FeatureDenied, type FeatureDeniedProps } from './feature-denied.js';
export { FeatureGate, type FeatureGateProps } from './feature-gate.js';
export { permissionsWebModule } from './module.js';
export { AdminPage, AdminPlaceholder } from './pages/admin-page.js';
export { FeatureEditPage } from './pages/feature-edit-page.js';
export { FeatureForm } from './pages/feature-form.js';
export { FeatureImportPage } from './pages/feature-import-page.js';
export { FeatureNewPage } from './pages/feature-new-page.js';
export { FeaturesPage } from './pages/features-page.js';
export { InviteUserPage } from './pages/invite-user-page.js';
export { MyOrganizationsPage } from './pages/my-organizations-page.js';
export { OrganizationDetailPage } from './pages/organization-detail-page.js';
export { OrganizationHomePage } from './pages/organization-home-page.js';
export { OrganizationMembersPage } from './pages/organization-members-page.js';
export { OrganizationNewPage } from './pages/organization-new-page.js';
export { OrganizationNotices } from './pages/organization-notices.js';
export {
  InvitationsSection,
  MemberRoles,
  MembersSection,
  PlanSummary,
  WorkspacesSection,
  when,
} from './pages/organization-sections.js';
export { OrganizationSettingsPage } from './pages/organization-settings-page.js';
export { OrganizationSubscriptionPage } from './pages/organization-subscription-page.js';
export { OrganizationWorkspacePage } from './pages/organization-workspace-page.js';
export { OrganizationWorkspaceSettingsPage } from './pages/organization-workspace-settings-page.js';
export { OrganizationWorkspacesPage } from './pages/organization-workspaces-page.js';
export { OrganizationsPage } from './pages/organizations-page.js';
export { Person, personLabel } from './pages/person.js';
export { PlanEditPage } from './pages/plan-edit-page.js';
export { PlanForm, type PlanFormProps } from './pages/plan-form.js';
export { PlanNewPage } from './pages/plan-new-page.js';
export { PlansPage } from './pages/plans-page.js';
export { RegistryOutput } from './pages/registry-output.js';
export { RoleEditPage } from './pages/role-edit-page.js';
export { RoleForm, type RoleFormProps } from './pages/role-form.js';
export { RoleNewPage } from './pages/role-new-page.js';
export { RolesPage } from './pages/roles-page.js';
export { SubscriptionEditPage } from './pages/subscription-edit-page.js';
export { SubscriptionForm, type SubscriptionFormProps } from './pages/subscription-form.js';
export { SubscriptionNewPage } from './pages/subscription-new-page.js';
export { SubscriptionsPage } from './pages/subscriptions-page.js';
export { TenantPage } from './pages/tenant-page.js';
export { type MyOrganizationState, useMyOrganization } from './pages/use-my-organization.js';
export { WorkspaceDetailPage } from './pages/workspace-detail-page.js';
export {
  AddWorkspaceMemberDialog,
  WorkspaceMemberRole,
  WorkspaceMembers,
  WorkspaceSettings,
} from './pages/workspace-sections.js';
export {
  createPermissionsClient,
  DEFAULT_GRAPHQL_PATH,
  type FoundUser,
  type InvitationView,
  type InviteResult,
  type MemberRoleView,
  type MemberView,
  type MyOrganizationView,
  type MyWorkspaceView,
  type OrganizationDetailView,
  type OrganizationView,
  type PermissionsClient,
  type PlanInput,
  type PlanView,
  type RoleInput,
  type RoleView,
  type SubscriptionInput,
  type SubscriptionView,
  type WorkspaceDetailView,
  type WorkspaceMemberView,
  type WriteResult,
} from './permissions-client.js';
export { PermissionsProvider, type PermissionsProviderProps, PermissionsReactContext } from './permissions-provider.js';
/*
 * The realtime CONTRACT only. `createRealtimeConnection` is deliberately absent:
 * it is the one function that imports `graphql-ws`, an optional peer, and a
 * barrel that re-exported it would make every consumer resolve a WebSocket
 * client to render a roles table. It lives at
 * `@kwtech/module-permissions/react/realtime`.
 */
export {
  DEFAULT_WS_TICKET_PATH,
  PLAN_CHANGED,
  type RealtimeConnection,
  type RealtimeOptions,
} from './realtime-contract.js';
/*
 * From `tenant-nav.ts`, which is NOT a client module — deliberately. The app's
 * server-side navigation builder reads `ORGANIZATION_NAV_GROUP`'s VALUE, and a
 * constant exported from a `'use client'` file is a client-reference proxy on
 * the server, not a string. See that file.
 */
export {
  ORGANIZATION_NAV_GROUP,
  ORGANIZATION_NEW_HREF,
  ORGANIZATIONS_HREF,
  organizationHref,
  organizationSectionHref,
  WORKSPACE_NAV_GROUP,
  workspaceHref,
} from './tenant-nav.js';
export {
  useCanAccessWorkspace,
  useFeatureDecision,
  useHasAllFeatures,
  useHasAnyFeature,
  useHasFeature,
  usePermissions,
} from './use-permissions.js';
