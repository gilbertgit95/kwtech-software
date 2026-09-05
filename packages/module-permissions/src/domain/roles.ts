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
  /**
   * The badge icon, as a NAME — 'crown', 'sprout' — never a component.
   *
   * This package is imported by the NestJS server, so it may not name a
   * `LucideIcon` any more than `@kwtech/module-kit` may: that is the same rule
   * `nav.icon` follows, and it is what lets a second frontend draw the same
   * role in its own set.
   *
   * Optional, because a role is still a role without one. It is pure
   * presentation and carries NO authority — `assertRoleFeatureLevels` ignores
   * it, and nothing may ever branch on it. A crown is a label, and treating a
   * label as a right is how a role stops describing what its holder can do.
   */
  icon?: string;
}

/**
 * A role may only collect features at its own level — EXCEPT at app level.
 *
 * The rule exists because creating workspace roles is a routine, widely
 * delegated right: without it, anyone able to define a workspace role can put
 * `billing:manage` in one and grant themselves an organization-wide power. That
 * is privilege escalation, not a typo, so it fails loudly rather than being
 * filtered out.
 *
 * App level is exempt because the escalation it guards against cannot happen
 * there. An app-level role is not attached to a membership and is not
 * creatable by a tenant administrator; minting one is a platform operation, so
 * there is no lesser right to escalate FROM. Applying the rule there bought no
 * safety and made "platform staff who can do everything" impossible to express:
 * only two registry keys are app-level, so the strictest possible super admin
 * could still not read an organization's roles or fix its billing.
 *
 * The read path already assumed this shape. `composeContext` applies an
 * app-level role at every scope and unions its features in AFTER the
 * subscription filter, so an app role holding organization-level features
 * resolves exactly as intended — everywhere, regardless of what the customer
 * bought. Only this write-time assertion stood in the way. See domain/grants.ts.
 *
 * An unregistered key is still refused at every level, app included: a key no
 * spec declares can never be checked, so a role carrying one grants nothing
 * while reading as access.
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
    if (role.level !== 'app' && spec.level !== role.level) {
      problems.push(`'${key}' is ${spec.level}-level, role '${role.key}' is ${role.level}-level`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid role '${role.key}': ${problems.join('; ')}`);
  }
}

/**
 * What the role editor may offer for a role at this level.
 *
 * Mirrors assertRoleFeatureLevels rather than partitioning the registry: an
 * app-level role may collect anything, so the editor offers it everything.
 * Organization and workspace roles still see only their own level's keys, which
 * is what stops the editor presenting a choice the write path will refuse.
 */
export function featuresForLevel(specs: readonly FeatureSpec[], level: RoleLevel): FeatureSpec[] {
  if (level === 'app') return [...specs];
  return specs.filter((spec) => spec.level === level);
}

/**
 * Every feature in the registry, for the role that is meant to hold all of them.
 *
 * Derived rather than listed so a key added to the registry is granted by the
 * super admin role on the next seed run. A hand-maintained list would decay
 * silently: the role would keep its name and quietly stop being all-access,
 * which is discovered as a denied request months later.
 */
export function allFeatureKeys(specs: readonly FeatureSpec[]): FeatureKey[] {
  return specs.map((spec) => spec.key).sort();
}
