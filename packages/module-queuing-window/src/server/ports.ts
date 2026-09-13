/**
 * The questions this module needs answered and cannot answer itself.
 *
 * Every one reads tables another module owns — membership and grants belong to
 * `module-permissions`, names to `module-auth` — and a module may not import a
 * module (PLAN §9). So each is a structural port the APP fills, and each
 * absence has a documented MEANING rather than a crash.
 */

/**
 * Is this person a member of the workspace who holds `queue:serve` there?
 *
 * Asked when a window is ASSIGNED, and when the console loads to flag a seat
 * whose holder can no longer serve.
 *
 * ⚠ UNBOUND MEANS YOU MAY ASSIGN ONLY YOURSELF. The guard has proven the actor;
 * anybody else is someone the module cannot vouch for. Fail closed.
 */
export interface QueueStaffCheck {
  canServe(organizationId: string, workspaceId: string, userId: string): Promise<boolean>;
}

export interface QueueStaffMember {
  userId: string;
  displayName: string;
}

/**
 * The people a window can be assigned to, and names for the console.
 *
 * ⚠ These are ACCOUNT names, for staff on the console. They never reach a public
 * display — only a nickname does (see `boardNickname`).
 *
 * UNBOUND means the picker is empty and a seat reads "a member".
 */
export interface QueueStaffDirectory {
  /** Workspace members who can serve there. */
  listServers(organizationId: string, workspaceId: string): Promise<readonly QueueStaffMember[]>;
  describe(userIds: readonly string[]): Promise<readonly QueueStaffMember[]>;
}

export interface QueueWorkspaceLocation {
  organizationId: string;
  workspaceId: string;
  workspaceName: string;
}

/**
 * Organization and workspace KEYS → ids, for the public display URL
 * `/queue-display/:organizationKey/:workspaceKey`.
 *
 * ⚠ Null for an unknown organization, an unknown workspace and an archived one
 * alike: the display must not tell those apart, or the public page becomes a
 * directory of customers.
 *
 * UNBOUND MEANS NO DISPLAY CAN OPEN.
 */
export interface QueueWorkspaceLocator {
  locate(organizationKey: string, workspaceKey: string): Promise<QueueWorkspaceLocation | null>;
}
