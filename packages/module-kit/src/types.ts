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
  /**
   * The scope a role must be at to grant this.
   *
   * Here rather than only in the enforcing module, for the reason this whole
   * interface is here: every module declares rights, and a right is not fully
   * declared without saying how far it reaches. Without it a module could name
   * a key and nothing else — leaving the LEVEL, which is what stops a workspace
   * role carrying an organization-wide power, to be invented by whoever wired
   * the module up.
   *
   * Optional because the enforcer requires it and this contract does not: a
   * consumer with no permission model at all still composes descriptors.
   * `@kwtech/module-permissions` narrows it to required in its own `FeatureSpec`.
   */
  level?: FeatureLevel;
  /**
   * Where the key is actually enforced. A key with no bindings guards nothing
   * while reading as coverage; one whose binding names a surface that has no
   * guard is worse. See the enforcing module for the full surface list — this
   * is typed loosely so a module can declare a surface this package has never
   * heard of.
   */
  bindings?: readonly { surface: string; identifier: string }[];
  /**
   * Cross-cutting labels, for grouping and filtering a long registry.
   *
   * A feature already has three groupings — its module, its level, and the
   * namespace in its key — and every one of them is a HIERARCHY: a key belongs
   * to exactly one. Tags exist for the groupings that are not hierarchical.
   * "admin" spans `features:*`, `roles:*`, `members:*` and `billing:*`, and no
   * single tree can say that without duplicating something.
   *
   * ⚠️ PRESENTATION ONLY. Nothing may grant, deny or infer access from a tag.
   * "Everyone with the admin tag" is a wildcard grant by another name, and the
   * model already rejected one of those — a role row has to describe what its
   * holder can do, and a tag is a label somebody can change. The enforcing
   * module asserts this in its tests rather than trusting it.
   */
  tags?: readonly string[];
}

/**
 * How far a right reaches. Mirrors `RoleLevel` in the enforcing module.
 *
 * Duplicated deliberately rather than imported: this package must not depend on
 * `@kwtech/module-permissions` — the dependency runs the other way — and three
 * string literals are a smaller cost than that inversion. The enforcer's own
 * type is checked against this one where it matters.
 */
export type FeatureLevel = 'app' | 'organization' | 'workspace';

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
   * Feature key required to reach it.
   *
   * Read by the navigation filter (`composeNav`) AND by whatever renders the
   * route, so a route cannot be linked-to-but-unprotected — the usual way a
   * menu and a guard drift apart. In this workspace that renderer is the app's
   * catch-all page, which refuses before the component is called.
   *
   * It said "the app's middleware", and that was WRONG — middleware there
   * renews a session and explicitly does not decide who may see what, so half
   * the promise was never kept. A route whose component did not gate itself was
   * reachable by anyone signed in, and the descriptor said otherwise.
   *
   * NONE OF THIS IS THE SECURITY BOUNDARY. It decides what a person is shown;
   * every request is authorised again at the API, which is the only check an
   * attacker calling it directly cannot skip.
   */
  feature?: string;
  /** Omit to keep the route reachable but unlisted. */
  nav?: { group: string; order?: number; icon?: string };
  /**
   * Which shell the route renders inside. Defaults to 'app' — the header, the
   * side drawer and the account menu.
   *
   * 'bare' is for the pages that exist BECAUSE there is no session yet:
   * sign-in, forgot-password, reset-password. Wrapping those in a shell whose
   * whole content is "who is signed in and what may they reach" would be a
   * shell with nothing to say, and its account menu would be furniture around
   * an empty chair.
   *
   * Declared per route rather than inferred from the path, because '/auth' is
   * a naming convention and this is a rendering decision — an app that renamed
   * the prefix would silently lose the distinction.
   */
  chrome?: 'app' | 'bare';
}

export interface ServerModuleDescriptor {
  key: string;
  /** The DynamicModule returned by the module's forRoot(). Typed loosely so this package never imports Nest. */
  nestModule: unknown;
  /** Mounts the module's controllers under a prefix, via the app's RouterModule. */
  routePrefix?: string;
  features?: readonly FeatureContribution[];
}

/**
 * Where a NAV GROUP sits in the drawer, contributed by whichever module owns it.
 *
 * Exists because group placement was the last thing an app still had to edit by
 * hand for every module it adopted: `composeNav` can only sort group names
 * alphabetically, so the app kept a `GROUP_ORDER` array and a new module's group
 * silently landed at the bottom until someone remembered to promote it. That is
 * exactly the per-module edit the descriptor is supposed to remove.
 *
 * A NAME, not a reference: two modules may contribute entries to one group —
 * 'Administration' is the obvious case — so the group is a shared namespace and
 * neither module owns it outright. See `composeNavGroups` for how two
 * suggestions about one group are resolved.
 */
export interface NavGroupContribution {
  /** Matches `ModuleRoute.nav.group` exactly. */
  group: string;
  /** Lower is higher up the drawer. Space them — 10, 50, 90 — so one can be inserted between. */
  order: number;
}

export interface WebModuleDescriptor {
  key: string;
  routes?: readonly ModuleRoute[];
  /**
   * Where this module's nav groups belong, so adopting it stays a one-line edit.
   *
   * Optional: a module that contributes to a group someone else placed — or that
   * does not care — simply omits it and the group sorts after every declared one.
   */
  navGroups?: readonly NavGroupContribution[];
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
