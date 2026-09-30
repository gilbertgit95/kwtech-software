import type { PosFeatureKey } from '../feature-keys.js';

/**
 * The questions this module needs answered and cannot answer itself.
 *
 * Grants belong to `module-permissions` and names to `module-auth`, and a
 * module may not import a module (PLAN §9). So each is a structural port the
 * APP fills, and each absence has a documented MEANING rather than a crash.
 */

/**
 * Does this person hold `key` in this workspace — after the plan filter,
 * exactly as the guard would resolve it?
 *
 * Asked where a key changes WHAT an operation returns or keeps, rather than
 * whether it runs (the binding already decided that):
 *
 * - `pos:manage_items` / `pos:reports`: whether costs are in the answer at all
 *   (guard rules, "cost stays on the server");
 * - `pos:discount`: whether an edit keeps a fixed discount somebody else gave.
 *
 * ⚠ UNBOUND MEANS NO. Costs never leave the server, and fixed discounts drop
 * on every edit. Fail closed.
 */
export interface PosAccessCheck {
  holds(organizationId: string, workspaceId: string, userId: string, key: PosFeatureKey): Promise<boolean>;
}

/**
 * The workspace's IANA time zone (`perm_workspace.timeZone`): which day a sale
 * belongs to, and when "today" starts. Null when the app cannot say.
 *
 * UNBOUND MEANS `DEFAULT_TIME_ZONE` (Asia/Manila), never UTC.
 */
export interface PosWorkspaceTimeZone {
  timeZoneOf(organizationId: string, workspaceId: string): Promise<string | null>;
}

export interface PosMember {
  userId: string;
  displayName: string;
}

/**
 * Names, for "by staff" and for who did what on an order. An id it does not
 * know is left out, and the app says "a former member".
 *
 * UNBOUND MEANS NOBODY HAS A NAME.
 */
export interface PosMemberDirectory {
  describe(userIds: readonly string[]): Promise<readonly PosMember[]>;
}
