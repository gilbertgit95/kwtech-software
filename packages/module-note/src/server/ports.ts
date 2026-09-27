/**
 * The questions this module needs answered and cannot answer itself.
 *
 * Grants belong to `module-permissions` and names to `module-auth`, and a module
 * may not import a module (PLAN §9). So each is a structural port the APP fills,
 * and each absence has a documented MEANING rather than a crash.
 */

/**
 * Does this person hold `note:manage_all` in this workspace — after the plan
 * filter, exactly as the guard would resolve it?
 *
 * ⚠ ASKED ONLY WHEN IT DECIDES SOMETHING: trashing, restoring or deleting
 * somebody ELSE'S SHARED note (`planNoteBinAct` → `needs_manage_all`). Never on
 * a read path, and never for a private note, which is `not_found` first.
 *
 * ⚠ UNBOUND MEANS NO. You act on your own notes only. Fail closed.
 */
export interface NoteAccessCheck {
  holdsManageAll(organizationId: string, workspaceId: string, userId: string): Promise<boolean>;
}

export interface NoteAuthor {
  userId: string;
  displayName: string;
}

/**
 * Names for authors and last editors, shown beside notes and in a conflict
 * ("Changed by Ana"). ACCOUNT names: every reader is a signed-in member.
 *
 * UNBOUND means no names: the app says "a member". An id it does not know is
 * simply left out of the answer.
 */
export interface NoteAuthorDirectory {
  describe(userIds: readonly string[]): Promise<readonly NoteAuthor[]>;
}
