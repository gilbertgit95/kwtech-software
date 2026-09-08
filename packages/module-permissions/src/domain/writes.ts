import type { FeatureSpec, RoleLevel } from '../types.js';
import { assertRoleFeatureLevels, type RoleDefinition } from './roles.js';

/**
 * The rules a WRITE must satisfy, as pure decisions.
 *
 * The read side already refuses a cross-tenant grant defensively (C3), but a
 * defensive filter is not a substitute for rejecting the row: a grant that is
 * written and then ignored still shows in the role editor, still reads as
 * access in an audit, and comes back the moment anyone "fixes" the filter.
 * These are the checks that stop it being written at all.
 *
 * Pure and framework-free, like the rest of domain/, so the same rule holds in
 * a resolver, a CLI command, a seed script and a test.
 */

/**
 * Why a write was refused.
 *
 * Kept distinct from `DenialReason` (check.ts) on purpose. That one answers "may
 * you do this at all"; these answer "this particular row would be wrong". A
 * caller who holds every right in the system still cannot assign another
 * tenant's role, and telling them "access denied" would send them to an
 * administrator who can change nothing.
 */
export type WriteRefusalReason =
  /** The actor's own grants do not include the right this write needs. */
  | 'not_permitted'
  /** The role belongs to a different organization than the member it would be attached to. */
  | 'role_foreign_to_organization'
  /** The role's level does not match where it is being attached. */
  | 'role_level_mismatch'
  /** The role collects a feature no role at its level may grant. */
  | 'role_features_invalid'
  /**
   * The submitted draft is malformed — a missing label, an unparseable cap, a
   * plan selling an app-level key.
   *
   * Separate from `role_features_invalid`, which names one specific rule about
   * one specific table. This is the general "these fields are wrong" answer the
   * plan and subscription forms produce, and collapsing the two would make a
   * refusal about a blank plan label report itself as a role feature problem.
   */
  | 'draft_invalid'
  /** A cap is already reached. Distinct from not_permitted: buy more, do not ask an admin. */
  | 'at_capacity'
  /** The target does not exist, or does not belong to the tenant in hand. */
  | 'not_found'
  /** The row is already there. Writes are idempotent where they can be; this is where they cannot. */
  | 'already_exists'
  /**
   * The HOST has not wired something the write needs — today, a way to deliver
   * an invitation email.
   *
   * Not the actor's problem and not the row's: nothing the person at the screen
   * can type will fix it, and it must not read as "you may not do that". It is
   * a deployment fault, and saying so is what sends it to the person who can
   * actually resolve it.
   */
  | 'not_configured';

/**
 * Thrown by the write path instead of a Nest exception, so the service is
 * callable from a worker, a CLI and a test that never load Nest. `/server`
 * exports a mapper to HTTP status codes for the apps that want one.
 */
export class PermissionWriteError extends Error {
  constructor(
    readonly reason: WriteRefusalReason,
    message: string,
    /** Extra context for the message a user finally sees — a cap and a count, a role key. */
    readonly detail: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'PermissionWriteError';
  }
}

/** The fields a write needs to judge a role. A partial row, not the whole model. */
export interface AssignableRole {
  key: string;
  /** The human name, read where a role is NAMED to somebody — an email, a screen. */
  label: string;
  level: RoleLevel;
  /** Null for a shared preset, which every organization may use. */
  organizationId: string | null;
}

/**
 * Whether a role may be attached to a member of this organization, at this
 * level.
 *
 * Two independent failures, reported separately because they need different
 * fixes:
 *
 *   ownership  the role was defined by another organization. A bug or a
 *              compromised admin endpoint in one tenant could otherwise grant a
 *              role defined in another. This is C3's write side.
 *   level      an organization-level role attached to a workspace membership
 *              would grant organization-wide rights to anyone who can administer
 *              one workspace — and creating workspace roles is a routine,
 *              widely delegated right.
 */
export function assertRoleAssignable(role: AssignableRole, target: { organizationId: string; level: RoleLevel }): void {
  if (role.organizationId !== null && role.organizationId !== target.organizationId) {
    throw new PermissionWriteError(
      'role_foreign_to_organization',
      `Role '${role.key}' belongs to another organization and cannot be granted here`,
      { roleKey: role.key, roleOrganizationId: role.organizationId, organizationId: target.organizationId },
    );
  }

  if (role.level !== target.level) {
    throw new PermissionWriteError(
      'role_level_mismatch',
      `Role '${role.key}' is ${role.level}-level and cannot be granted at ${target.level} level`,
      { roleKey: role.key, roleLevel: role.level, targetLevel: target.level },
    );
  }
}

/**
 * Whether a role definition is coherent before it is stored.
 *
 * Wraps assertRoleFeatureLevels — which existed, was exported, and was called by
 * nothing (H1) — so that defining a role is the moment the rule is enforced
 * rather than a rule the seed task was one day supposed to check.
 */
export function assertRoleDefinable(role: RoleDefinition, specs: readonly FeatureSpec[]): void {
  try {
    assertRoleFeatureLevels(role, specs);
  } catch (error) {
    throw new PermissionWriteError('role_features_invalid', (error as Error).message, { roleKey: role.key });
  }
}

/**
 * An app-level role cannot be attached to a membership at all: a membership is
 * (user, organization), and an app-level role has neither an organization nor a
 * workspace to hang from. It goes on PermUserRole instead.
 *
 * Separate from assertRoleAssignable because it is not a mismatch to report —
 * it is a different table, and saying "wrong level" would suggest the fix is to
 * pick a different level rather than a different call.
 */
export function assertNotAppLevel(role: AssignableRole): void {
  if (role.level === 'app') {
    throw new PermissionWriteError(
      'role_level_mismatch',
      `Role '${role.key}' is app-level: grant it to the user directly, not through a membership`,
      { roleKey: role.key },
    );
  }
}
