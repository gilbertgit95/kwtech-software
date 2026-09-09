import type {
  FeatureContribution,
  ModuleRoute,
  NavEntry,
  NavGroupContribution,
  ServerModuleDescriptor,
  WebModuleDescriptor,
} from './types.js';

/**
 * Composition is the point of this package: an app lists its modules once and
 * everything downstream — routes, navigation, middleware, the seed registry —
 * derives from that list. Adding the tenth module is the same one-line edit as
 * adding the second.
 */

/** Thrown rather than warned: two modules owning one path is a wiring bug, and a silent winner is worse than a failed boot. */
export class ModuleCompositionError extends Error {}

/** Flattens every module's routes and rejects duplicate paths. */
export function composeRoutes(modules: readonly WebModuleDescriptor[]): ModuleRoute[] {
  const byPath = new Map<string, string>();
  const routes: ModuleRoute[] = [];

  for (const mod of modules) {
    for (const route of mod.routes ?? []) {
      const owner = byPath.get(route.path);
      if (owner) {
        throw new ModuleCompositionError(`Route ${route.path} declared by both '${owner}' and '${mod.key}'`);
      }
      byPath.set(route.path, mod.key);
      routes.push(route);
    }
  }
  return routes;
}

export interface ComposeNavOptions {
  /**
   * Values for the `:params` in a route's path — `{ organizationId: 'org_1' }`.
   *
   * A route whose path has no dynamic segments ignores this entirely and is
   * listed as it always was. A route that HAS them is listed only when every
   * one of them can be filled, and its href is the substituted path.
   *
   * ## Why a route drops out rather than degrading
   *
   * `/organizations/:organizationId/members` is not a URL. Listing it with the
   * placeholder still in it produces a link that 404s, and listing it with the
   * segment removed produces a link to somebody else's page — both are worse
   * than the entry not being there. "No active organization" is a real state,
   * and the honest rendering of a nav entry that needs one is its absence.
   *
   * ## Why this and not a second descriptor field
   *
   * A route already declares its dynamic segments, in its path. Asking a module
   * to ALSO declare "this entry needs an organization" would be the same fact
   * written twice, and the failure of forgetting the second one is a broken
   * link in a drawer rather than an error anywhere.
   */
  params?: Readonly<Record<string, string | undefined>>;
}

/**
 * Substitutes `:param` segments, or returns undefined when one has no value.
 *
 * Undefined rather than a partial path: a caller that got half a URL would have
 * to check for a colon in it, and the one that forgot would ship the link.
 */
function fillPath(path: string, params: Readonly<Record<string, string | undefined>>): string | undefined {
  if (!path.includes(':')) return path;

  const filled: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment.startsWith(':')) {
      filled.push(segment);
      continue;
    }
    const value = params[segment.slice(1)];
    // An empty string is as unusable as a missing one: it collapses the segment
    // and shifts every id after it one place left.
    if (!value) return undefined;
    filled.push(encodeURIComponent(value));
  }
  return filled.join('/');
}

/**
 * Navigation, derived from the same route list the renderer protects — which is
 * what stops a menu linking somewhere the guard will refuse.
 *
 * Pass `heldFeatures` to filter; omit it to get the unfiltered menu (the role
 * editor wants that). Pass `options.params` to resolve routes with dynamic
 * segments — see `ComposeNavOptions`.
 */
export function composeNav(
  modules: readonly WebModuleDescriptor[],
  heldFeatures?: readonly string[],
  options: ComposeNavOptions = {},
): NavEntry[] {
  const entries: NavEntry[] = [];
  const params = options.params ?? {};

  for (const route of composeRoutes(modules)) {
    if (!route.nav) continue;
    if (heldFeatures && route.feature && !heldFeatures.includes(route.feature)) continue;

    /*
     * The FEATURE filter runs first and the params second, and the order is
     * not arbitrary: an entry the reader may not hold should be absent whether
     * or not a scope happens to be active, so the cheaper and more important
     * check is the one that cannot be skipped.
     */
    const href = fillPath(route.path, params);
    if (href === undefined) continue;

    entries.push({
      group: route.nav.group,
      order: route.nav.order ?? 0,
      label: route.title,
      href,
      ...(route.nav.icon !== undefined ? { icon: route.nav.icon } : {}),
      ...(route.feature !== undefined ? { feature: route.feature } : {}),
    });
  }

  return entries.sort((a, b) => a.group.localeCompare(b.group) || a.order - b.order || a.label.localeCompare(b.label));
}

/**
 * Where each nav group sits, merged across every module that had an opinion.
 *
 * ## Why the lowest order wins rather than throwing
 *
 * Duplicate ROUTES and duplicate FEATURE KEYS throw, because two modules owning
 * one of those is a wiring bug. A group is the opposite: it is a shared
 * namespace by design — 'Administration' is meant to collect entries from
 * several modules — so two modules each naming a position for it is the normal
 * case, not a conflict to refuse.
 *
 * Taking the minimum makes the result independent of the order modules are
 * listed in, which is the property that matters: `[a, b]` and `[b, a]` must
 * produce the same drawer. It also gives a module that considers a group
 * central to it the ability to pull the group up, without being able to push
 * another module's group down.
 *
 * Groups nobody placed are simply absent from this list — see `navGroupRank`.
 */
export function composeNavGroups(modules: readonly WebModuleDescriptor[]): NavGroupContribution[] {
  const lowest = new Map<string, number>();

  for (const mod of modules) {
    for (const contribution of mod.navGroups ?? []) {
      const existing = lowest.get(contribution.group);
      if (existing === undefined || contribution.order < existing) {
        lowest.set(contribution.group, contribution.order);
      }
    }
  }

  return [...lowest.entries()]
    .map(([group, order]) => ({ group, order }))
    .sort((a, b) => a.order - b.order || a.group.localeCompare(b.group));
}

/**
 * A comparable rank for a group name, for sorting entries into groups.
 *
 * An UNDECLARED group ranks after every declared one, rather than before. A new
 * module whose group nobody placed appears at the bottom of the drawer, which is
 * visible and harmless; ranking it first would put an unknown module's pages
 * above the dashboard on the day it was installed.
 */
export function navGroupRank(groups: readonly NavGroupContribution[], group: string): number {
  const found = groups.find((entry) => entry.group === group);
  return found ? found.order : Number.MAX_SAFE_INTEGER;
}

/**
 * The full grantable vocabulary across every module, for the seed task and the
 * role editor. Duplicate keys throw: two modules defining 'records:write'
 * differently is exactly the ambiguity a shared registry exists to prevent.
 */
export function composeFeatures(
  modules: readonly (WebModuleDescriptor | ServerModuleDescriptor)[],
): FeatureContribution[] {
  const seen = new Map<string, string>();
  const features: FeatureContribution[] = [];

  for (const mod of modules) {
    for (const feature of mod.features ?? []) {
      const owner = seen.get(feature.key);
      if (owner) {
        throw new ModuleCompositionError(`Feature '${feature.key}' declared by both '${owner}' and '${mod.key}'`);
      }
      seen.set(feature.key, mod.key);
      features.push(feature);
    }
  }
  return features;
}

/** A matched route plus whatever its `:params` captured. */
export interface RouteMatch {
  route: ModuleRoute;
  /** Empty for a route with no dynamic segments. Values are URL-decoded. */
  params: Record<string, string>;
}

/**
 * Scores a candidate so a LITERAL segment always beats a dynamic one.
 *
 * Without this, '/admin/features/new/manual' and '/admin/features/:id/edit' are
 * both plausible for the first path and the winner would be whichever module
 * happened to be listed first — a route that works until someone reorders
 * WEB_MODULES. Literal segments are worth more than dynamic ones at every
 * position, so a fully literal path always wins.
 */
function specificity(pattern: readonly string[]): number {
  return pattern.reduce((score, segment) => score + (segment.startsWith(':') ? 1 : 2), 0);
}

/**
 * Matches one route pattern against one path, or returns undefined.
 *
 * Segment counts must be equal: '/a/:b' does not match '/a/b/c'. A pattern that
 * swallowed extra segments would make '/admin/features/:id' match
 * '/admin/features/new/manual' and quietly capture 'new'.
 */
function matchPattern(path: string, pathname: string): Record<string, string> | undefined {
  const pattern = path.split('/');
  const actual = pathname.split('/');
  if (pattern.length !== actual.length) return undefined;

  const params: Record<string, string> = {};
  for (const [index, segment] of pattern.entries()) {
    const value = actual[index];
    if (value === undefined) return undefined;

    if (segment.startsWith(':')) {
      // An empty segment is not a value: '/features//edit' must not match
      // '/features/:id/edit' with an id of ''.
      if (value === '') return undefined;
      params[segment.slice(1)] = decodeURIComponent(value);
      continue;
    }
    if (segment !== value) return undefined;
  }
  return params;
}

/**
 * Matches a URL path against the composed routes, most specific first.
 *
 * Used by the catch-all page and by middleware, so the route a request renders
 * and the route it is authorised against are resolved by the same function —
 * which is what stops a page rendering under one route's feature key while
 * being guarded by another's.
 *
 * Supports `:param` segments: '/admin/features/:featureId/edit'. The captured
 * values reach the component as `ModuleRouteProps.params`.
 */
export function matchRouteWithParams(routes: readonly ModuleRoute[], pathname: string): RouteMatch | undefined {
  let best: (RouteMatch & { score: number }) | undefined;

  for (const route of routes) {
    const params = matchPattern(route.path, pathname);
    if (!params) continue;

    const score = specificity(route.path.split('/'));
    if (!best || score > best.score) best = { route, params, score };
  }

  if (best) return { route: best.route, params: best.params };

  /*
   * PREFIX fallback, kept from before this function understood parameters.
   *
   * A route may own everything beneath it — a module that renders its own
   * sub-navigation from the rest of the path. Only reached when nothing matched
   * exactly, so a real route always wins over a prefix owner, and longest
   * prefix wins among them.
   */
  const prefix = routes
    .filter((route) => pathname.startsWith(`${route.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];

  return prefix ? { route: prefix, params: {} } : undefined;
}

/** The route alone, for callers that do not need the captured params — middleware, mostly. */
export function matchRoute(routes: readonly ModuleRoute[], pathname: string): ModuleRoute | undefined {
  return matchRouteWithParams(routes, pathname)?.route;
}

/** Nest wiring is already generic — the app spreads this into `imports`. */
export function serverModuleImports(modules: readonly ServerModuleDescriptor[]): unknown[] {
  return modules.map((mod) => mod.nestModule);
}

/** Feeds the app's RouterModule.register(), for modules that asked for a prefix. */
export function serverRoutePrefixes(modules: readonly ServerModuleDescriptor[]): { path: string; module: unknown }[] {
  return modules
    .filter((mod) => mod.routePrefix)
    .map((mod) => ({ path: mod.routePrefix as string, module: mod.nestModule }));
}
