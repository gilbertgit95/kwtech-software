import type { FeatureKey, RoleLevel } from '../types.js';

/**
 * A role as `rolesHoldingFeature` needs it: what it is called and what it grants.
 *
 * Structural on purpose, so the same function reads a `perm_role` row in the
 * service and a `SystemRoleDefinition` in the app's seed test. The test that
 * pins "the roles named for a key are the seeded ones" is only worth having if
 * it runs THIS rule, not a copy of it.
 */
export interface RoleHolderCandidate {
  key: string;
  label: string;
  level: RoleLevel;
  description?: string | null | undefined;
  features: readonly FeatureKey[];
}

/** One role that would allow a refused act, as a refusal names it (#99). */
export interface RoleHolder {
  key: string;
  label: string;
  level: RoleLevel;
  description: string | null;
}

/**
 * The roles that hold `featureKey`, for a `not_granted` refusal to name (#99):
 * "Refunds need the Supervisor or Workspace admin role."
 *
 * ## Only roles AT THE FEATURE'S LEVEL
 *
 * Levels reach downward, so an organization role can carry a workspace key —
 * the organization owner holds every workspace-admin right through the
 * organization. Naming it beside the workspace roles would be true and no use:
 * the person refused at the till needs the role someone in the shop can give
 * them, and that is a workspace role. The organization's roles are named for
 * the organization's keys.
 *
 * App-level keys name nobody. Those are the platform's own staff rights (the
 * admin pages, approving billing); telling a customer "this needs the Super
 * admin role" names a role nobody they can ask is able to give, so the
 * refusal keeps its general sentence.
 *
 * ## Fewest rights first
 *
 * Sorted by how much each role grants, smallest first, so the sentence names
 * the LEAST trusted role that would do: "the Supervisor or Workspace admin
 * role", not the other way round. An admin reading it gives the first one that
 * fits instead of the most powerful one listed.
 *
 * The caller passes LIVE roles only; a disabled role grants nothing and must
 * not be suggested.
 */
export function rolesHoldingFeature(
  roles: readonly RoleHolderCandidate[],
  featureKey: FeatureKey,
  featureLevel: RoleLevel,
): RoleHolder[] {
  if (featureLevel === 'app') return [];
  return roles
    .filter((role) => role.level === featureLevel && role.features.includes(featureKey))
    .sort((a, b) => a.features.length - b.features.length || a.label.localeCompare(b.label))
    .map((role) => ({ key: role.key, label: role.label, level: role.level, description: role.description ?? null }));
}

/** What a `not_granted` refusal needs to name the roles: the act, its level, who holds it. */
export interface NotGrantedInput {
  /** The feature's label, "Refund and void". */
  featureLabel: string;
  featureLevel: RoleLevel;
  holders: readonly RoleHolder[];
}

/**
 * "“Refund and void” needs the Supervisor or Workspace admin role. Ask a
 * workspace admin to give you one." (#99)
 *
 * Null when no role at the feature's level holds it: the general sentence
 * ("Your roles do not include this. An administrator can grant it.") is then
 * the truthful one, and a sentence naming nothing would read as a bug.
 *
 * The label is QUOTED because feature labels are verb phrases ("Take
 * payment", "Refund and void"), which do not read as the subject of a
 * sentence without them.
 */
export function notGrantedText(input: NotGrantedInput): string | null {
  if (input.holders.length === 0) return null;
  // "the Supervisor or Workspace admin ROLE", singular: one of them is enough.
  const names = joinWithOr(input.holders.map((role) => role.label));
  return `“${input.featureLabel}” needs the ${names} role. ${askWho(input.featureLevel)}`;
}

/**
 * Who can give the role, by its level. A workspace role is assigned by the
 * workspace's admin (and the organization's admins, who are told the same
 * thing by their own screens); an organization role by the organization's.
 */
function askWho(level: RoleLevel): string {
  switch (level) {
    case 'workspace':
      return 'Ask a workspace admin to give you one.';
    case 'organization':
      return "Ask the organization's owner or an admin to give you one.";
    case 'app':
      return 'Ask the platform’s staff.';
  }
}

/** "A", "A or B", "A, B or C". */
function joinWithOr(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
}
