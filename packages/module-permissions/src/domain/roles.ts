import type { FeatureKey, FeatureSpec, RoleLevel } from '../types.js';

/**
 * A role is a named collection of features. Nothing else — no inheritance, no
 * implied rights, no precedence. Everything a role means is the list it carries,
 * which is what makes "what can this person do" answerable by reading one row
 * set instead of simulating a hierarchy.
 */
export interface RoleDefinition {
  key: string;
  label: string;
  level: RoleLevel;
  features: readonly FeatureKey[];
}

/**
 * A role may only collect features at its own level.
 *
 * Without this a workspace-level role can quietly contain `billing:manage`, and
 * anyone able to create workspace roles — which is a routine, widely delegated
 * right — can grant themselves an organization-wide one. That is privilege
 * escalation, not a typo, so it fails loudly rather than being filtered out.
 */
export function assertRoleFeatureLevels(role: RoleDefinition, specs: readonly FeatureSpec[]): void {
  const byKey = new Map(specs.map((spec) => [spec.key, spec]));
  const problems: string[] = [];

  for (const key of role.features) {
    const spec = byKey.get(key);
    if (!spec) {
      problems.push(`'${key}' is not in the registry`);
      continue;
    }
    if (spec.level !== role.level) {
      problems.push(`'${key}' is ${spec.level}-level, role '${role.key}' is ${role.level}-level`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid role '${role.key}': ${problems.join('; ')}`);
  }
}

/** What the role editor may offer for a role at this level. */
export function featuresForLevel(specs: readonly FeatureSpec[], level: RoleLevel): FeatureSpec[] {
  return specs.filter((spec) => spec.level === level);
}
