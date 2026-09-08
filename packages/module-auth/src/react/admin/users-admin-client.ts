'use client';

import { type AuthClient, createAuthClient } from '../auth-client.js';

/**
 * How the administration pages talk to the API.
 *
 * Built ON TOP of `AuthClient.graphql` rather than beside it, so every request
 * here goes through the same app-owned route handler that attaches the session
 * from the httpOnly cookie. A second transport would be a second place for the
 * token handling to be got wrong, and the token handling is the part a package
 * must not implement (see auth-client.ts).
 *
 * The shapes below mirror `server/graphql/users-admin.types.ts`. They are
 * written out rather than imported from it because those classes carry
 * @nestjs/graphql decorators, and a browser bundle must not pull Nest in — the
 * same rule that keeps the server types out of the pure core.
 */

export interface AdminUser {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  /** 'active' | 'suspended'. A string, mirroring the column. */
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminUserDetail extends AdminUser {
  hasTwoFactor: boolean;
  activeSessions: number;
}

export interface AdminUserSession {
  id: string;
  issuedAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  mfaSatisfied: boolean;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AdminUserWriteResult {
  changed: boolean;
  sessionsRevoked: number;
  user: AdminUser | null;
}

/**
 * The APP-level role a person holds, as `module-permissions` reports it.
 *
 * Shaped here rather than imported, for the reason every type in this file is:
 * these two modules do not import each other. See the note on the client
 * interface about the operations that produce it.
 */
export interface UserAppRole {
  userId: string;
  roleId: string;
  roleKey: string;
  roleLabel: string;
  roleIcon: string | null;
}

/** An app-level role this administrator may hand out. */
export interface AssignableAppRole {
  id: string;
  key: string;
  label: string;
  /** What it grants, used to sort by least-privileged and to filter escalation. */
  features: readonly string[];
}

export interface AdminUserFilter {
  search?: string;
  status?: 'active' | 'suspended';
  skip?: number;
  take?: number;
}

export interface UsersAdminClient {
  listUsers(filter?: AdminUserFilter): Promise<{ rows: AdminUser[]; total: number }>;
  getUser(userId: string): Promise<AdminUserDetail>;
  /** Live sessions only — a revoked row is history, not "signed in now". */
  listSessions(userId: string): Promise<AdminUserSession[]>;

  createUser(input: { email: string; password: string; displayName?: string | null }): Promise<AdminUser>;
  updateProfile(userId: string, input: { displayName?: string; username?: string }): Promise<AdminUser>;
  setSuspended(userId: string, suspended: boolean): Promise<AdminUserWriteResult>;
  sendPasswordReset(userId: string): Promise<AdminUserWriteResult>;
  revokeSessions(userId: string): Promise<AdminUserWriteResult>;
  removeTwoFactor(userId: string): Promise<AdminUserWriteResult>;

  /*
   * ── three operations THIS MODULE DOES NOT DEFINE ─────────────────────────
   *
   * ⚠ `permissionUserAppRoles`, `permissionRoles` and `assignAppRole` belong to
   * `@kwtech/module-permissions`. They are named here by CONVENTION, exactly as
   * that module's own client names the app-provided `findUserByEmail` and
   * `findUsersByIds` — the two modules cannot import each other, and an
   * operation name travelling over the wire is not an import.
   *
   * An app composing this module WITHOUT a permissions module gets a users
   * screen that still works: every caller below FAILS SOFT, so the app-role
   * column is empty and the picker is absent rather than the page being blank.
   * That is the price of the convention, paid where a reader can see it.
   */

  /** The app-level role each of these people holds. Absent for those with none. */
  listUserAppRoles(userIds: readonly string[]): Promise<UserAppRole[]>;
  /** Every app-level role that is not disabled, for a picker. */
  listAssignableAppRoles(): Promise<AssignableAppRole[]>;
  /** Sets one person's app-level role, replacing whatever they held. */
  setAppRole(userId: string, roleId: string): Promise<void>;
}

const USER_FIELDS = 'id email username displayName status createdAt lastLoginAt';
const WRITE_FIELDS = `changed sessionsRevoked user { ${USER_FIELDS} }`;

export function createUsersAdminClient(auth: AuthClient = createAuthClient()): UsersAdminClient {
  return {
    async listUsers(filter = {}) {
      const data = await auth.graphql<{ adminUsers: { rows: AdminUser[]; total: number } }>(
        `query AdminUsers($search: String, $status: String, $skip: Int, $take: Int) {
           adminUsers(search: $search, status: $status, skip: $skip, take: $take) {
             rows { ${USER_FIELDS} }
             total
           }
         }`,
        {
          search: filter.search ?? null,
          status: filter.status ?? null,
          skip: filter.skip ?? null,
          take: filter.take ?? null,
        },
      );
      return data.adminUsers;
    },

    async getUser(userId) {
      const data = await auth.graphql<{ adminUser: AdminUserDetail }>(
        `query AdminUser($userId: String!) {
           adminUser(userId: $userId) { ${USER_FIELDS} hasTwoFactor activeSessions }
         }`,
        { userId },
      );
      return data.adminUser;
    },

    async listSessions(userId) {
      const data = await auth.graphql<{ adminUserSessions: AdminUserSession[] }>(
        `query AdminUserSessions($userId: String!) {
           adminUserSessions(userId: $userId) {
             id issuedAt lastUsedAt expiresAt mfaSatisfied ipAddress userAgent
           }
         }`,
        { userId },
      );
      return data.adminUserSessions;
    },

    async createUser(input) {
      const data = await auth.graphql<{ adminCreateUser: AdminUser }>(
        `mutation AdminCreateUser($email: String!, $password: String!, $displayName: String) {
           adminCreateUser(email: $email, password: $password, displayName: $displayName) { ${USER_FIELDS} }
         }`,
        { email: input.email, password: input.password, displayName: input.displayName ?? null },
      );
      return data.adminCreateUser;
    },

    async updateProfile(userId, input) {
      const data = await auth.graphql<{ adminUpdateUserProfile: AdminUser }>(
        `mutation AdminUpdateUserProfile($userId: String!, $displayName: String, $username: String) {
           adminUpdateUserProfile(userId: $userId, displayName: $displayName, username: $username) { ${USER_FIELDS} }
         }`,
        // `?? null` on both: an omitted argument and an explicit null are the
        // same over the wire, and the resolver reads null as "not provided" so
        // that clearing a field is never something a partial form does by
        // accident.
        { userId, displayName: input.displayName ?? null, username: input.username ?? null },
      );
      return data.adminUpdateUserProfile;
    },

    async setSuspended(userId, suspended) {
      const data = await auth.graphql<{ adminSetUserStatus: AdminUserWriteResult }>(
        `mutation AdminSetUserStatus($userId: String!, $suspended: Boolean!) {
           adminSetUserStatus(userId: $userId, suspended: $suspended) { ${WRITE_FIELDS} }
         }`,
        { userId, suspended },
      );
      return data.adminSetUserStatus;
    },

    async sendPasswordReset(userId) {
      const data = await auth.graphql<{ adminSendPasswordReset: AdminUserWriteResult }>(
        `mutation AdminSendPasswordReset($userId: String!) {
           adminSendPasswordReset(userId: $userId) { ${WRITE_FIELDS} }
         }`,
        { userId },
      );
      return data.adminSendPasswordReset;
    },

    async revokeSessions(userId) {
      const data = await auth.graphql<{ adminRevokeUserSessions: AdminUserWriteResult }>(
        `mutation AdminRevokeUserSessions($userId: String!) {
           adminRevokeUserSessions(userId: $userId) { ${WRITE_FIELDS} }
         }`,
        { userId },
      );
      return data.adminRevokeUserSessions;
    },

    async listUserAppRoles(userIds) {
      if (userIds.length === 0) return [];
      try {
        const data = await auth.graphql<{ permissionUserAppRoles: UserAppRole[] }>(
          `query UserAppRoles($userIds: [String!]!) {
             permissionUserAppRoles(userIds: $userIds) { userId roleId roleKey roleLabel roleIcon }
           }`,
          { userIds: [...userIds] },
        );
        return data.permissionUserAppRoles;
      } catch {
        /*
         * Swallowed on purpose — see the note on the interface. No permissions
         * module, or a reader without `roles:read`, means the column has
         * nothing to show; neither is a reason for the accounts list to fail.
         */
        return [];
      }
    },

    async listAssignableAppRoles() {
      try {
        const data = await auth.graphql<{
          permissionRoles: {
            id: string;
            key: string;
            label: string;
            level: string;
            disabled: boolean;
            features: string[];
          }[];
        }>(
          `query AssignableAppRoles {
             permissionRoles { id key label level disabled features }
           }`,
          {},
        );
        return data.permissionRoles
          .filter((role) => role.level === 'app' && !role.disabled)
          .map((role) => ({ id: role.id, key: role.key, label: role.label, features: role.features }));
      } catch {
        return [];
      }
    },

    async setAppRole(userId, roleId) {
      // NOT swallowed. The two reads above degrade to an empty column, which is
      // a page that works; a failed WRITE that reported success would be a lie
      // about somebody's permissions.
      await auth.graphql(
        `mutation AssignAppRole($userId: String!, $roleId: String!) {
           assignAppRole(userId: $userId, roleId: $roleId) { changed }
         }`,
        { userId, roleId },
      );
    },

    async removeTwoFactor(userId) {
      const data = await auth.graphql<{ adminRemoveUserTwoFactor: AdminUserWriteResult }>(
        `mutation AdminRemoveUserTwoFactor($userId: String!) {
           adminRemoveUserTwoFactor(userId: $userId) { ${WRITE_FIELDS} }
         }`,
        { userId },
      );
      return data.adminRemoveUserTwoFactor;
    },
  };
}
