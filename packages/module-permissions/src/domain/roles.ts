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
 * How wide a level reaches. LOWER is broader.
 *
 *   app 0          every organization
 *   organization 1 one organization, all its workspaces
 *   workspace 2    one workspace
 */
const LEVEL_REACH: Record<RoleLevel, number> = { app: 0, organization: 1, workspace: 2 };

/**
 * May a role at `roleLevel` grant a feature declared at `featureLevel`?
 *
 * **Downward yes, upward never.** A role may collect features at its own level
 * and at any NARROWER one; it may never collect a broader one.
 *
 *   app role          → app, organization and workspace features
 *   organization role → organization and workspace features
 *   workspace role    → workspace features only
 *
 * ## Why downward is safe
 *
 * Granting a narrower right from a broader role adds nothing the role did not
 * already reach. An organization role already applies inside every workspace of
 * its organization (see `composeContext`), so letting it carry
 * `workspaces:share` lets it say something it was already entitled to say.
 *
 * ## Why upward is the dangerous direction
 *
 * Creating workspace roles is routine and widely delegated. If a workspace role
 * could carry `billing:manage`, anyone able to define one could grant
 * themselves an organization-wide power from inside a single workspace. That is
 * privilege escalation, not a typo, which is why it fails loudly rather than
 * being quietly filtered.
 *
 * This REPLACES the old exact-match rule and its app-level exemption: "app may
 * collect anything" is no longer a special case, it is what this rule says when
 * the role is at reach 0.
 *
 * ONE implementation, deliberately. The same question was previously answered
 * in five places — the write assertion, the editor's option list, the draft
 * validator, the clone filter and the role form — and five copies of a
 * security rule is four chances for one of them to drift.
 */
export function canRoleGrant(roleLevel: RoleLevel, featureLevel: RoleLevel): boolean {
  return LEVEL_REACH[featureLevel] >= LEVEL_REACH[roleLevel];
}

/**
 * A role may only collect features its level actually reaches.
 *
 * The rule is `canRoleGrant` above: own level or narrower, never broader. It
 * exists because creating workspace roles is a routine, widely delegated right
 * — without it, anyone able to define a workspace role can put `billing:manage`
 * in one and grant themselves an organization-wide power. That is privilege
 * escalation, not a typo, so it fails loudly rather than being filtered out.
 *
 * The read path already assumed the permissive direction. `composeContext`
 * applies an app-level role at every scope and an organization role inside
 * every workspace, unioning app-level features in AFTER the subscription
 * filter — so a broader role carrying a narrower feature resolves exactly as
 * intended. Only this write-time assertion stood in the way.
 *
 * An unregistered key is still refused at every level: a key no spec declares
 * can never be checked, so a role carrying one grants nothing while reading as
 * access.
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
    if (!canRoleGrant(role.level, spec.level)) {
      problems.push(`'${key}' is ${spec.level}-level, which is broader than ${role.level}-level role '${role.key}'`);
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
  return specs.filter((spec) => canRoleGrant(level, spec.level));
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
