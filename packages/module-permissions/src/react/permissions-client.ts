'use client';

import type { CloneMode } from '../domain/role-draft.js';

/**
 * How this module's screens reach the API.
 *
 * ## Why the module cannot just call the API
 *
 * The browser has no route to it. `API_URL` is deliberately not `NEXT_PUBLIC_`
 * — publishing the API origin to every visitor is what the httpOnly-cookie
 * design exists to avoid — so every call goes through a route handler on the
 * app's own origin, which attaches the bearer token from the cookie.
 *
 * ## Why the path is a PARAMETER and not a constant
 *
 * That route handler belongs to `@kwtech/module-auth`, and these two modules may
 * not know about each other (PLAN §9). Hardcoding `/api/auth/graphql` here would
 * be this module naming the other one's URL — the same coupling the seam avoids,
 * smuggled in as a string instead of an import.
 *
 * So the default is the path this app happens to mount, and any app that mounts
 * it elsewhere passes its own. Apps configure; modules do not guess (§9 rule 6).
 * It is the same arrangement `SecurityPage` uses for `twoFactorHref`.
 */
export const DEFAULT_GRAPHQL_PATH = '/api/auth/graphql';

/** A role definition, as the screens read it. Mirrors `PermissionRoleDetail`. */
export interface RoleView {
  id: string;
  key: string;
  label: string;
  level: string;
  organizationId: string | null;
  icon: string | null;
  isSystem: boolean;
  disabled: boolean;
  features: string[];
}

export interface RoleInput {
  key: string;
  label: string;
  level: string;
  icon: string | null;
  features: string[];
}

/**
 * A feature as the editor needs it: enough to filter by level and nest by tag.
 *
 * Fetched rather than read from the compiled registry, so the list matches what
 * the SERVER will accept — including features declared by other modules, which
 * this package cannot import. See `featureRegistry`.
 */
export interface FeatureView {
  key: string;
  module: string;
  label: string;
  description: string;
  isPrivileged: boolean;
  level: string;
  tags: string[];
}

export interface ClonePreview {
  features: string[];
  added: string[];
  skipped: { key: string; reason: string }[];
}

export interface PermissionsClient {
  /** Every grantable feature, from every module the app composed. */
  listFeatures(): Promise<FeatureView[]>;
  listRoles(organizationId?: string | null): Promise<RoleView[]>;
  createRole(input: RoleInput): Promise<RoleView>;
  updateRole(roleId: string, input: RoleInput): Promise<RoleView>;
  setRoleDisabled(roleId: string, disabled: boolean): Promise<RoleView>;
  previewClone(input: {
    sourceRoleId: string;
    current: readonly string[];
    level: string;
    mode: CloneMode;
  }): Promise<ClonePreview>;
}

const ROLE_FIELDS = 'id key label level organizationId icon isSystem disabled features';

export function createPermissionsClient(options: { graphqlPath?: string } = {}): PermissionsClient {
  const path = options.graphqlPath ?? DEFAULT_GRAPHQL_PATH;

  /**
   * One request shape for every call.
   *
   * Throws on `errors` so each caller writes one happy path. The FIRST error's
   * message is surfaced rather than a generic one: the API's refusals are
   * already written for a reader — "Requires all of: roles:create" says exactly
   * what is missing, and replacing it with "Something went wrong" throws away
   * the only useful thing in the response.
   */
  async function graphql<T>(document: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // The session is an httpOnly cookie on this origin; without this the
      // request goes out unauthenticated and every call 401s.
      credentials: 'same-origin',
      body: JSON.stringify({ query: document, variables }),
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(response.status === 401 ? 'Your session has ended. Sign in again.' : 'Cannot reach the server.');
    }

    const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'The request was refused.');
    if (!body.data) throw new Error('The server returned no data.');
    return body.data;
  }

  return {
    async listFeatures() {
      /*
       * `limit` is the server's own cap, and it can only ever narrow — asking
       * for more returns the cap, not an error. The registry is 19 keys today;
       * if it outgrows a page this needs to follow `hasMore`, and the count
       * below is what will make that obvious rather than silent.
       */
      const data = await graphql<{ permissionFeatures: { items: FeatureView[]; total: number } }>(
        `query PermissionFeatures {
           permissionFeatures {
             total
             items { key module label description isPrivileged level tags }
           }
         }`,
      );
      return data.permissionFeatures.items;
    },

    async listRoles(organizationId = null) {
      const data = await graphql<{ permissionRoles: RoleView[] }>(
        `query PermissionRoles($organizationId: String) {
           permissionRoles(organizationId: $organizationId) { ${ROLE_FIELDS} }
         }`,
        { organizationId },
      );
      return data.permissionRoles;
    },

    async createRole(input) {
      const data = await graphql<{ createRole: RoleView }>(
        `mutation CreateRole($input: RoleDraftInput!) {
           createRole(input: $input) { ${ROLE_FIELDS} }
         }`,
        { input },
      );
      return data.createRole;
    },

    async updateRole(roleId, input) {
      const data = await graphql<{ updateRole: RoleView }>(
        `mutation UpdateRole($roleId: String!, $input: RoleDraftInput!) {
           updateRole(roleId: $roleId, input: $input) { ${ROLE_FIELDS} }
         }`,
        { roleId, input },
      );
      return data.updateRole;
    },

    async setRoleDisabled(roleId, disabled) {
      const data = await graphql<{ setRoleDisabled: RoleView }>(
        `mutation SetRoleDisabled($roleId: String!, $disabled: Boolean!) {
           setRoleDisabled(roleId: $roleId, disabled: $disabled) { ${ROLE_FIELDS} }
         }`,
        { roleId, disabled },
      );
      return data.setRoleDisabled;
    },

    async previewClone({ sourceRoleId, current, level, mode }) {
      const data = await graphql<{ previewRoleClone: ClonePreview }>(
        `mutation PreviewRoleClone($sourceRoleId: String!, $level: String!, $mode: String!, $current: [String!]!) {
           previewRoleClone(sourceRoleId: $sourceRoleId, level: $level, mode: $mode, current: $current) {
             features added skipped { key reason }
           }
         }`,
        { sourceRoleId, level, mode, current: [...current] },
      );
      return data.previewRoleClone;
    },
  };
}
