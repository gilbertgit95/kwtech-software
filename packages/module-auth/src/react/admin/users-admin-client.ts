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
  deleteUser(userId: string): Promise<AdminUserWriteResult>;
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

    async removeTwoFactor(userId) {
      const data = await auth.graphql<{ adminRemoveUserTwoFactor: AdminUserWriteResult }>(
        `mutation AdminRemoveUserTwoFactor($userId: String!) {
           adminRemoveUserTwoFactor(userId: $userId) { ${WRITE_FIELDS} }
         }`,
        { userId },
      );
      return data.adminRemoveUserTwoFactor;
    },

    async deleteUser(userId) {
      const data = await auth.graphql<{ adminDeleteUser: AdminUserWriteResult }>(
        `mutation AdminDeleteUser($userId: String!) {
           adminDeleteUser(userId: $userId) { ${WRITE_FIELDS} }
         }`,
        { userId },
      );
      return data.adminDeleteUser;
    },
  };
}
