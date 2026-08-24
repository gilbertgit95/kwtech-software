import type { ModuleRoute } from '@kwtech/module-kit';
import type { FeatureBinding, FeatureKey, FeatureSpec, FeatureSurface } from './types.js';

/**
 * Keeps the registry honest.
 *
 * Scope of what this can check: **enforcement is opt-in**, so a surface with no
 * key is not checked at all — /auth/signin is a route, not a feature, and no
 * audit here will ever mention it. What is audited is the registry itself:
 * every key should guard something, and everything guarded should have a key.
 * Both halves drift silently otherwise — an unbound key reads as coverage while
 * guarding nothing, and a guard on an unregistered key can never be granted, so
 * the check behind it always fails.
 *
 * What this deliberately CANNOT tell you is whether an unguarded surface was
 * meant to be guarded. That needs surfaces to declare themselves public rather
 * than being public by omission — see docs/PLAN.md §12.15.
 *
 * Run from the seed task and from a test, so drift breaks CI rather than
 * surfacing as "why can nobody use this button".
 */

export interface RegistryAudit {
  /** Declared but guarding nothing. Expected during buildout; not at release. */
  unbound: FeatureKey[];
  /** How many places each surface is enforced, for a coverage read at a glance. */
  bySurface: Record<FeatureSurface, number>;
  /** Bindings claimed by two keys — one surface, two answers, no way to tell which wins. */
  contested: { identifier: string; surface: FeatureSurface; keys: FeatureKey[] }[];
}

/**
 * ui_route bindings are derived rather than hand-written: the module's route
 * descriptors already say which key guards which path, and asking anyone to
 * repeat that in the registry only creates a second thing to forget.
 */
export function deriveRouteBindings(routes: readonly ModuleRoute[]): Map<FeatureKey, FeatureBinding[]> {
  const derived = new Map<FeatureKey, FeatureBinding[]>();
  for (const route of routes) {
    if (!route.feature) continue;
    const list = derived.get(route.feature) ?? [];
    list.push({ surface: 'ui_route', identifier: route.path });
    derived.set(route.feature, list);
  }
  return derived;
}

export function auditRegistry(specs: readonly FeatureSpec[], routes: readonly ModuleRoute[] = []): RegistryAudit {
  const derived = deriveRouteBindings(routes);
  const bySurface = {} as Record<FeatureSurface, number>;
  const owners = new Map<string, FeatureKey[]>();
  const unbound: FeatureKey[] = [];

  for (const spec of specs) {
    const declared = spec.bindings ?? [];
    const all = [...declared, ...(derived.get(spec.key) ?? [])];

    // Deduplicated: a route binding written by hand AND derived is one surface,
    // not two, and counting it twice would overstate coverage.
    const seen = new Set<string>();
    for (const binding of all) {
      const id = `${binding.surface}::${binding.identifier}`;
      if (seen.has(id)) continue;
      seen.add(id);

      bySurface[binding.surface] = (bySurface[binding.surface] ?? 0) + 1;
      owners.set(id, [...(owners.get(id) ?? []), spec.key]);
    }

    if (seen.size === 0) unbound.push(spec.key);
  }

  const contested = [...owners.entries()]
    .filter(([, keys]) => keys.length > 1)
    .map(([id, keys]) => {
      const [surface, identifier] = id.split('::') as [FeatureSurface, string];
      return { surface, identifier, keys };
    });

  return { unbound, bySurface, contested };
}

/**
 * The other direction: a key used in code must exist in the registry.
 *
 * Call it with the keys a guard, gate or route actually references — collected
 * from the module descriptors — so an unregistered key fails the build instead
 * of failing every permission check at runtime.
 */
export function assertRegistered(specs: readonly FeatureSpec[], used: readonly FeatureKey[]): void {
  const registered = new Set(specs.map((spec) => spec.key));
  const missing = [...new Set(used)].filter((key) => !registered.has(key));
  if (missing.length > 0) {
    throw new Error(`Feature keys used but not registered: ${missing.join(', ')}`);
  }
}
