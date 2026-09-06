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
export { OrganizationsPage } from './pages/organizations-page.js';
export { RegistryOutput } from './pages/registry-output.js';
export { RoleEditPage } from './pages/role-edit-page.js';
export { RoleForm, type RoleFormProps } from './pages/role-form.js';
export { RoleNewPage } from './pages/role-new-page.js';
export { RolesPage } from './pages/roles-page.js';
export { SubscriptionsPage } from './pages/subscriptions-page.js';
export {
  createPermissionsClient,
  DEFAULT_GRAPHQL_PATH,
  type PermissionsClient,
  type RoleInput,
  type RoleView,
} from './permissions-client.js';
export { PermissionsProvider, type PermissionsProviderProps, PermissionsReactContext } from './permissions-provider.js';
export {
  useCanAccessWorkspace,
  useFeatureDecision,
  useHasAllFeatures,
  useHasAnyFeature,
  useHasFeature,
  usePermissions,
} from './use-permissions.js';
