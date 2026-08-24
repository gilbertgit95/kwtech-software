import type { ComponentType } from 'react';

/**
 * The contract a module-* package fills in and an app composes.
 *
 * react is a type-only, optional peer: `import type` erases at build time, so a
 * server app importing this package pulls in nothing.
 */

/**
 * A grantable right a module contributes to the shared registry.
 *
 * Owned here rather than in module-permissions because every module declares
 * rights, while only one module enforces them. The enforcer imports this shape
 * like everyone else.
 */
export interface FeatureContribution {
  key: string;
  /** The module key, so the role editor can group by feature area. */
  module: string;
  label: string;
  description: string;
  /** Irreversible or heavily audited. Flagged in the role editor. */
  isPrivileged?: boolean;
}

/**
 * What a route's component is handed. `searchParams` is here because a real
 * route can depend on the query string — /auth/reset-password is nothing
 * without its token — and a descriptor that could not express that would push
 * every such page into hand-written app code, which is the duplication this
 * package exists to remove.
 */
export interface ModuleRouteProps {
  params?: Record<string, string>;
  searchParams?: Record<string, string | string[] | undefined>;
}

export interface ModuleRoute {
  /** App-absolute and leading-slash: '/admin/roles'. */
  path: string;
  component: ComponentType<ModuleRouteProps>;
  title: string;
  /**
   * Feature key required to reach it. Read by BOTH the navigation filter and
   * the app's middleware, so a route cannot be linked-to-but-unprotected — the
   * usual way a menu and a guard drift apart.
   */
  feature?: string;
  /** Omit to keep the route reachable but unlisted. */
  nav?: { group: string; order?: number; icon?: string };
}

export interface ServerModuleDescriptor {
  key: string;
  /** The DynamicModule returned by the module's forRoot(). Typed loosely so this package never imports Nest. */
  nestModule: unknown;
  /** Mounts the module's controllers under a prefix, via the app's RouterModule. */
  routePrefix?: string;
  features?: readonly FeatureContribution[];
}

export interface WebModuleDescriptor {
  key: string;
  routes?: readonly ModuleRoute[];
  /** Mounted around the app tree — a module's own React context, if it needs one. */
  Provider?: ComponentType<{ children: React.ReactNode }>;
  features?: readonly FeatureContribution[];
}

export interface NavEntry {
  group: string;
  order: number;
  label: string;
  href: string;
  icon?: string;
  feature?: string;
}
