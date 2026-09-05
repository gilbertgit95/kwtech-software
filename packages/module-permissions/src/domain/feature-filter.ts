import { normaliseTags } from '../feature-tags.js';
import type { FeatureSpec, RoleLevel } from '../types.js';

/**
 * Narrowing the registry — one implementation, used by the API and the page.
 *
 * ## Why it is a domain function and not a WHERE clause
 *
 * The registry is a compiled constant today and a database table tomorrow. Put
 * the rules in SQL and the page cannot reuse them; put them in the page and the
 * endpoint answers a different question from the screen. A pure function over a
 * list is the only shape both can share, and the day this moves to a table the
 * translation is mechanical — the SEMANTICS are already pinned down here and
 * tested.
 *
 * ## AND across facets, and the two different rules within one
 *
 *   modules, levels   OR within the facet. A feature has exactly ONE module and
 *                     ONE level, so requiring all of them would always match
 *                     nothing — that is arithmetic, not a preference.
 *   tags              ALL within the facet. A feature has MANY tags, so
 *                     intersecting is meaningful and is what makes each chip
 *                     narrow rather than widen.
 *
 * Different facets always AND: every filter added should reduce the list, which
 * is what someone means by filtering.
 */

export interface FeatureFilter {
  /** Case-insensitive substring, across key, label, description, module, tags and bindings. */
  search?: string | null | undefined;
  /** Any of these modules. Empty or absent means "no restriction". */
  modules?: readonly string[] | null | undefined;
  /** Any of these levels. */
  levels?: readonly string[] | null | undefined;
  /** ALL of these tags — see above. */
  tags?: readonly string[] | null | undefined;
  /** `true` for privileged only, `false` for ordinary only, absent for both. */
  isPrivileged?: boolean | null | undefined;
  /**
   * `true` for keys with NO binding — the ones that read as coverage in a role
   * editor while guarding nothing. The most useful audit question this list can
   * answer, and impossible to ask by eye once the registry is long.
   */
  unboundOnly?: boolean | null | undefined;
}

/** Everything a search should look at, lower-cased once per spec. */
function haystack(spec: FeatureSpec): string {
  return [
    spec.key,
    spec.label,
    spec.description,
    spec.module,
    spec.level,
    ...(spec.tags ?? []),
    ...(spec.bindings ?? []).map((binding) => binding.identifier),
  ]
    .join(' ')
    .toLowerCase();
}

/** Whether any filter is actually set — for deciding whether to show a "clear" control. */
export function isEmptyFilter(filter: FeatureFilter): boolean {
  return (
    !filter.search?.trim() &&
    !filter.modules?.length &&
    !filter.levels?.length &&
    !filter.tags?.length &&
    // `== null` catches undefined AND null, and lets `false` count as set —
    // "ordinary keys only" is a filter, not the absence of one.
    filter.isPrivileged == null &&
    !filter.unboundOnly
  );
}

export function filterFeatures(specs: readonly FeatureSpec[], filter: FeatureFilter = {}): FeatureSpec[] {
  /*
   * Normalised ONCE, outside the loop. `search` is lower-cased and the tag list
   * is put through the same normaliser the registry used, so `Access Control`
   * from a query string matches `access-control` in a spec rather than silently
   * matching nothing.
   */
  const search = filter.search?.trim().toLowerCase() ?? '';
  const modules = new Set(filter.modules ?? []);
  const levels = new Set(filter.levels ?? []);
  const tags = normaliseTags(filter.tags ?? []);

  return specs.filter((spec) => {
    if (modules.size > 0 && !modules.has(spec.module)) return false;
    if (levels.size > 0 && !levels.has(spec.level)) return false;
    if (tags.length > 0 && !tags.every((tag) => (spec.tags ?? []).includes(tag))) return false;

    // `!= null` on purpose: `false` is a real filter — "ordinary keys only".
    if (filter.isPrivileged != null && (spec.isPrivileged ?? false) !== filter.isPrivileged) return false;
    if (filter.unboundOnly && (spec.bindings ?? []).length > 0) return false;

    // Last, because it is the only one that builds a string.
    if (search && !haystack(spec).includes(search)) return false;
    return true;
  });
}

/** The distinct values present, for building the facet controls from the data itself. */
export function featureFacets(specs: readonly FeatureSpec[]): {
  modules: string[];
  levels: RoleLevel[];
} {
  return {
    modules: [...new Set(specs.map((spec) => spec.module))].sort(),
    /*
     * Ordered by blast radius rather than alphabetically, matching the grid's
     * own sort — a control that lists them app-first would read like a
     * hierarchy running the wrong way.
     */
    levels: (['workspace', 'organization', 'app'] as const).filter((level) =>
      specs.some((spec) => spec.level === level),
    ),
  };
}
