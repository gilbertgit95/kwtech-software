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

export { FeatureGate, type FeatureGateProps } from './feature-gate.js';
export { permissionsWebModule } from './module.js';
export { RolesPage } from './pages/roles-page.js';
export { PermissionsProvider, type PermissionsProviderProps, PermissionsReactContext } from './permissions-provider.js';
export {
  useCanAccessWorkspace,
  useFeatureDecision,
  useHasAllFeatures,
  useHasAnyFeature,
  useHasFeature,
  usePermissions,
} from './use-permissions.js';
