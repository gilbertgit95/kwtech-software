/**
 * The questions this module needs answered and cannot answer itself.
 *
 * Grants belong to `module-permissions` and names to `module-auth`, and a module
 * may not import a module (PLAN §9). So each is a structural port the APP fills,
 * and each absence has a documented MEANING rather than a crash.
 */

/**
 * Does this person hold `studio:manage_all` in this workspace — after the plan
 * filter, exactly as the guard would resolve it?
 *
 * ⚠ ASKED ONLY WHEN IT DECIDES SOMETHING: changing or deleting somebody ELSE'S
 * SHARED layout (`planChangeLayout` → `needs_manage_all`), and reading
 * everybody's print history. Never for a private layout, which is `not_found`
 * first.
 *
 * ⚠ UNBOUND MEANS NO. You act on your own only. Fail closed.
 */
export interface StudioAccessCheck {
  holdsManageAll(organizationId: string, workspaceId: string, userId: string): Promise<boolean>;
}

export interface StudioMember {
  userId: string;
  displayName: string;
}

/**
 * Names for a layout's owner and for who printed what, shown beside shared
 * layouts and in the history. ACCOUNT names: every reader is a signed-in member.
 *
 * UNBOUND means no names: the app says "a member". An id it does not know is
 * simply left out of the answer.
 */
export interface StudioMemberDirectory {
  describe(userIds: readonly string[]): Promise<readonly StudioMember[]>;
}
