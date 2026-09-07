import type { FeatureKey, FeatureSpec } from '../types.js';

/**
 * Copying one collection of features onto another, filtered by whatever rules
 * the destination obeys.
 *
 * Extracted so roles and plans share ONE implementation. They differ in exactly
 * two ways — which levels the destination may hold, and whether the actor's own
 * grants constrain it — and both are parameters below. Everything else (merge
 * versus replace, de-duplication, reporting what was dropped) was going to be
 * identical, and two copies of "what did this clone silently discard" is one
 * copy plus a way for the two screens to answer differently.
 */

/**
 * How a clone combines with what the destination already carries.
 *
 * Named for what happens to the rows ALREADY THERE rather than to the incoming
 * ones — that is the half at risk, since the source's features arrive either
 * way.
 */
export type CloneMode = 'replace' | 'add';

export interface CloneSkip {
  key: FeatureKey;
  reason: 'wrong_level' | 'not_held' | 'unregistered';
}

export interface CloneResult {
  /** What the destination should carry afterwards, sorted and de-duplicated. */
  features: FeatureKey[];
  /** Newly present that were not there before. */
  added: FeatureKey[];
  /**
   * Dropped, and WHY — a clone that silently carried less than the thing it
   * copied would be discovered as a denial weeks later. The screen shows this.
   */
  skipped: CloneSkip[];
}

export interface MergeFeaturesOptions {
  registry: readonly FeatureSpec[];
  /** Whether the destination may hold a feature declared at this spec's level. */
  accepts: (spec: FeatureSpec) => boolean;
  /**
   * The actor's own rights, for the no-escalation rule.
   *
   * Omitted skips the check entirely, which is right in two cases and only two:
   * a seed script, which is the machine and has no actor to be limited by, and
   * a PLAN — where the rule does not apply at all, because a plan entitles
   * rather than grants. See `clonePlanFeatures`.
   */
  actorFeatures?: readonly FeatureKey[];
}

/**
 * Filters rather than refuses, deliberately.
 *
 * A super admin's seventeen features cloned into an organization role would
 * fail validation wholesale, and the person would have no way to act on that
 * except to un-tick them one at a time. Dropping what cannot apply and SAYING
 * SO leaves them with a working destination and an accurate list of what did
 * not come across.
 *
 * Nothing here writes. The result is staged into a form and saved through the
 * ordinary update path, so a clone can never reach a rule a manual edit obeys.
 */
export function mergeFeatures(
  current: readonly FeatureKey[],
  incoming: readonly FeatureKey[],
  mode: CloneMode,
  options: MergeFeaturesOptions,
): CloneResult {
  const byKey = new Map(options.registry.map((spec) => [spec.key, spec]));
  const actor = options.actorFeatures ? new Set(options.actorFeatures) : null;
  const skipped: CloneSkip[] = [];
  const accepted: FeatureKey[] = [];

  for (const key of incoming) {
    const spec = byKey.get(key);
    if (!spec) {
      skipped.push({ key, reason: 'unregistered' });
      continue;
    }
    if (!options.accepts(spec)) {
      skipped.push({ key, reason: 'wrong_level' });
      continue;
    }
    if (actor && !actor.has(key)) {
      skipped.push({ key, reason: 'not_held' });
      continue;
    }
    accepted.push(key);
  }

  // 'replace' discards what was there; 'add' keeps it.
  const base = mode === 'replace' ? [] : [...current];
  const features = [...new Set([...base, ...accepted])].sort();
  const before = new Set(current);

  return { features, added: features.filter((key) => !before.has(key)), skipped };
}
