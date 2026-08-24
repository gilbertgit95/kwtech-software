import type {
  FeatureContribution,
  ModuleRoute,
  NavEntry,
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

/**
 * Navigation, derived from the same route list the middleware protects — which
 * is what stops a menu linking somewhere the guard will refuse.
 *
 * Pass `heldFeatures` to filter; omit it to get the unfiltered menu (the role
 * editor wants that).
 */
export function composeNav(modules: readonly WebModuleDescriptor[], heldFeatures?: readonly string[]): NavEntry[] {
  const entries: NavEntry[] = [];

  for (const route of composeRoutes(modules)) {
    if (!route.nav) continue;
    if (heldFeatures && route.feature && !heldFeatures.includes(route.feature)) continue;

    entries.push({
      group: route.nav.group,
      order: route.nav.order ?? 0,
      label: route.title,
      href: route.path,
      ...(route.nav.icon !== undefined ? { icon: route.nav.icon } : {}),
      ...(route.feature !== undefined ? { feature: route.feature } : {}),
    });
  }

  return entries.sort((a, b) => a.group.localeCompare(b.group) || a.order - b.order || a.label.localeCompare(b.label));
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

/**
 * Matches a URL path against the composed routes, longest-literal first so a
 * static segment always beats a dynamic one.
 *
 * Used by the catch-all page and by middleware, so the route a request renders
 * and the route it is authorised against are resolved by the same function.
 */
export function matchRoute(routes: readonly ModuleRoute[], pathname: string): ModuleRoute | undefined {
  const exact = routes.find((route) => route.path === pathname);
  if (exact) return exact;

  return routes
    .filter((route) => pathname.startsWith(`${route.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
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
