import type { FeatureKey, FeatureSpec, RoleLevel } from '../types.js';

/**
 * A plan is a named collection of features an organization can BUY, exactly as
 * a role is a named collection of features a person can be GIVEN.
 *
 * Nothing else — no inheritance, no implied entitlement, no precedence. All the
 * meaning is `features` and `limits`, which is what makes "what did this
 * organization pay for" answerable by reading one row set instead of simulating
 * a hierarchy. The same argument `RoleDefinition` makes, one axis over.
 */
export interface PlanDefinition {
  key: string;
  label: string;
  /**
   * Whether the plan appears in a catalogue customers can see.
   *
   * Listing, not entitlement: a private plan is fully live for anyone already
   * subscribed to it. Kept apart from `archivedAt` for that reason — "stop
   * offering this" and "stop honouring this" are different decisions, and a
   * single flag doing both is how a grandfathered customer loses their plan.
   */
  isPublic: boolean;
  /**
   * The badge icon, as a NAME — 'gem', 'rocket' — never a component.
   *
   * The same contract `RoleDefinition.icon` follows: this package is imported
   * by the NestJS server, so it may not name a `LucideIcon`, and a second
   * frontend draws the same plan in its own set.
   *
   * Optional, and pure presentation. `assertPlanFeatureLevels` ignores it and
   * nothing may branch on it — a plan is exactly the features and caps it
   * carries, and an icon implying a tier would be a second, unenforceable
   * account of what a customer bought.
   */
  icon?: string;
  features: readonly FeatureKey[];
  /**
   * The caps this plan sells. Seats, workspaces, workspace members.
   *
   * Required, not optional, and that is the difference from `RoleDefinition`:
   * `assertPlanLimits` refuses a plan missing a required key, because a plan
   * that omits one falls back to the registry floor of ONE and silently caps a
   * paying customer at a single seat. See ./limits.ts.
   */
  limits: Readonly<Record<string, number>>;
}

/**
 * The levels a plan may sell, and this is a rule rather than a convention.
 *
 * ## Why app level is excluded
 *
 * App-level grants are unioned into the answer AFTER the entitlement filter
 * (`composeContext` in ./grants.ts), precisely so a lapsed organization cannot
 * lock out the support engineer trying to fix it. The consequence is that an
 * app-level key inside a plan changes NO decision anywhere: it is never
 * consulted, because the grants that carry it skip the filter it would live in.
 *
 * A plan carrying one would therefore read as a sold feature in the catalogue
 * while entitling nobody to anything — the exact shape of lie the registry's
 * `bindings` audit exists to catch on the other side of the model. So it fails
 * loudly at definition time instead.
 *
 * ## Why this is not `canRoleGrant`
 *
 * Superficially both answer "may this collection hold that feature", and they
 * are deliberately NOT one function. A role's answer depends on the role's own
 * level and reaches downward from it; a plan has no level at all — an
 * organization buys it, and the organization contains its workspaces — so the
 * answer is the same two levels for every plan there will ever be. Folding them
 * together would mean inventing a level for plans that nothing else reads.
 */
export const PLAN_FEATURE_LEVELS: readonly RoleLevel[] = ['organization', 'workspace'];

/** Whether a plan may sell a feature declared at this level. See above. */
export function canPlanEntitle(featureLevel: RoleLevel): boolean {
  return PLAN_FEATURE_LEVELS.includes(featureLevel);
}

/**
 * What the plan editor may offer.
 *
 * Mirrors `assertPlanFeatureLevels` rather than being written beside it, for
 * the reason `featuresForLevel` gives: the editor must not present a choice the
 * write path refuses, and two copies of that rule is one chance for them to
 * drift.
 */
export function featuresForPlan(specs: readonly FeatureSpec[]): FeatureSpec[] {
  return specs.filter((spec) => canPlanEntitle(spec.level));
}

/**
 * A plan may only sell features an entitlement filter actually consults.
 *
 * Refuses an unregistered key at the same time and for the same reason
 * `assertRoleFeatureLevels` does: a key no spec declares can never be checked,
 * so a plan carrying one entitles nothing while reading as a sold feature.
 */
export function assertPlanFeatureLevels(plan: PlanDefinition, specs: readonly FeatureSpec[]): void {
  const byKey = new Map(specs.map((spec) => [spec.key, spec]));
  const problems: string[] = [];

  for (const key of plan.features) {
    const spec = byKey.get(key);
    if (!spec) {
      problems.push(`'${key}' is not in the registry`);
      continue;
    }
    if (!canPlanEntitle(spec.level)) {
      problems.push(
        `'${key}' is ${spec.level}-level, and app-level features are exempt from entitlement — a plan holding it would sell nothing`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid plan '${plan.key}': ${problems.join('; ')}`);
  }
}
