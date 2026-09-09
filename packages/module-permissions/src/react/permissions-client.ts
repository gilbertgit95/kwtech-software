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

/** A plan definition, as the screens read it. Mirrors `PermissionPlanDetail`. */
export interface PlanView {
  /** The primary key, and the id every screen addresses a plan by. */
  key: string;
  label: string;
  isPublic: boolean;
  /** Icon NAME, or null. Resolved to a component by the frontend. See PermPlan.icon. */
  icon: string | null;
  archived: boolean;
  features: string[];
  /** Key/value pairs rather than a map — see `PermissionPlanDetailType.limits`. */
  limits: { limitKey: string; value: number }[];
}

export interface PlanInput {
  key: string;
  label: string;
  isPublic: boolean;
  icon: string | null;
  features: string[];
  /** Values are STRINGS, matching `PlanDraft.limits`: the domain validator owns what a number is. */
  limits: { limitKey: string; value: string }[];
}

/** A subscription, as the screens read it. Mirrors `PermissionSubscription`. */
export interface SubscriptionView {
  id: string;
  organizationId: string;
  organizationName: string;
  workspaceId: string | null;
  workspaceName: string | null;
  planKey: string;
  planLabel: string;
  /** Icon NAME, null for a plan that never chose one. Drawn by the app's set. */
  planIcon: string | null;
  /** An archived plan entitles nothing, however live this row looks. */
  planArchived: boolean;
  status: string;
  /** ISO timestamps, or null. Rendered, never computed with — see `toSubscriptionView`. */
  currentPeriodEnd: string | null;
  endedAt: string | null;
}

export interface SubscriptionInput {
  organizationId: string;
  workspaceId: string | null;
  planKey: string;
  status: string;
  /** `YYYY-MM-DD`, or empty for no renewal date. */
  currentPeriodEnd: string;
}

/** An organization, for the admin list and the subscription form's pickers. */
export interface OrganizationView {
  id: string;
  key: string;
  name: string;
  /** What it is, in the tenant's own words. Null only for an untouched legacy row. */
  description: string | null;
  /** Active members only. */
  memberCount: number;
  /** Live workspaces only. */
  workspaceCount: number;
  workspaces: { id: string; key: string; name: string }[];
}

/**
 * One organization, with its people and workspaces.
 *
 * ⚠ A member is a `userId` and nothing else. The permissions module does not
 * own identity, so a NAME has to be joined by whoever is rendering — see
 * `findUserByEmail` and the note on `MemberView.user`.
 */
export interface OrganizationDetailView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  workspaces: WorkspaceDetailView[];
  members: MemberView[];
  /** Who has been ASKED, and what became of the asking. */
  invitations: InvitationView[];
}

/**
 * An invitation, as the organization screen shows it.
 *
 * No token: it is handed out once, in the email, and stored only as a hash.
 * `InviteResult` below is the only place it ever appears.
 */
export interface InvitationView {
  id: string;
  email: string;
  /** 'pending' | 'accepted' | 'revoked' | 'expired'. DERIVED — see `invitationState`. */
  state: string;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  invitedByUserId: string;
  /** Who accepted, which need not be who was invited — an address is a mailbox. */
  acceptedByUserId: string | null;
  role: MemberRoleView | null;
}

/**
 * What sending an invitation reports back.
 *
 * No token — deliberately. The server mints it, hashes it and hands it to the
 * mailer; the browser never holds a working invitation link, so nothing here
 * has to be treated as a credential.
 */
export interface InviteResult {
  invitationId: string;
  /**
   * Whether the email actually went out.
   *
   * False still means the invitation EXISTS: it is live and acceptable, and
   * nobody has been told. Worth saying on screen — the address can be told
   * another way, or the invitation revoked.
   */
  delivered: boolean;
}

export interface WorkspaceDetailView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  /** Archived workspaces are shown, so the switch does not read as a delete. */
  archived: boolean;
  memberCount: number;
  members: WorkspaceMemberView[];
}

export interface WorkspaceMemberView {
  workspaceMemberId: string;
  membershipId: string;
  userId: string;
  /**
   * The WORKSPACE-level role. At most one, like an organization role — a list
   * because the shape predates the rule, and readers take the first.
   */
  roles: MemberRoleView[];
}

export interface MemberView {
  membershipId: string;
  userId: string;
  /** 'active' | 'invited' | 'suspended'. Only `active` participates in a check. */
  status: string;
  joinedAt: string;
  roles: MemberRoleView[];
  workspaceIds: string[];
}

export interface MemberRoleView {
  id: string;
  key: string;
  label: string;
  level: string;
  icon: string | null;
}

/**
 * One organization the VIEWER belongs to, for the switcher and the picker.
 *
 * The membership, not the organization — the role is the point, and an
 * organization has no role. `userId` is the viewer's own, and carried only
 * because the server type is shared with the admin screens' batch read.
 */
export interface MyOrganizationView {
  userId: string;
  organizationId: string;
  organizationKey: string;
  organizationName: string;
  /** Null for a member holding no role, which is a legitimate membership. */
  roleKey: string | null;
  roleLabel: string | null;
  /** The organization's own description, for the picker that lists them. */
  organizationDescription: string | null;
  /** Icon NAME, drawn by whatever set the app published. */
  roleIcon: string | null;
}

/**
 * One workspace of the viewer's organization, with the pool it can draw members
 * from.
 *
 * `organizationMembers` is everyone in the ORGANIZATION — the workspace's own
 * are on `workspace.members`, and the difference between the two lists is
 * exactly who can still be added.
 */
export interface MyWorkspaceView {
  organizationId: string;
  organizationKey: string;
  organizationName: string;
  workspace: WorkspaceDetailView;
  organizationMembers: MemberView[];
}

/** What `findUserByEmail` returns. Null means no account with that address. */
export interface FoundUser {
  id: string;
  email: string;
  displayName: string | null;
  username: string | null;
}

/**
 * What a write did.
 *
 * `changed: false` is a SUCCESS — re-granting a role somebody holds, or
 * removing them from a workspace they are not in, leaves the world in the state
 * asked for. A screen says "already done" rather than claiming an action it did
 * not take.
 */
export interface WriteResult {
  changed: boolean;
  id: string | null;
  /**
   * Whether something was DISPLACED to make room.
   *
   * Only `assignRole` sets it: a member holds at most one organization-level
   * role, so granting one silently removes the previous. A screen saying only
   * "granted" would hide the half of the outcome somebody might not have
   * intended.
   */
  replaced: boolean;
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

  /** Every plan the platform defines, archived ones included. */
  listPlans(): Promise<PlanView[]>;
  createPlan(input: PlanInput): Promise<PlanView>;
  updatePlan(planKey: string, input: PlanInput): Promise<PlanView>;
  setPlanArchived(planKey: string, archived: boolean): Promise<PlanView>;
  previewPlanClone(input: {
    sourcePlanKey: string;
    current: readonly string[];
    mode: CloneMode;
  }): Promise<ClonePreview>;

  /** Who is on what. Ended subscriptions included — they are the history. */
  listSubscriptions(organizationId?: string | null): Promise<SubscriptionView[]>;
  /** The tenants, for the admin list and the subscription form. */
  listOrganizations(): Promise<OrganizationView[]>;
  /** One organization, with its people and workspaces. Null when it does not exist. */
  getOrganization(organizationId: string): Promise<OrganizationDetailView | null>;
  createOrganization(key: string, name: string, description?: string | null): Promise<WriteResult>;
  /**
   * Renames an organization.
   *
   * Both fields, always — the caller sends what it is showing. An update taking
   * optional ones would make "leave the key" and "clear the key" the same
   * request.
   */
  updateOrganization(
    organizationId: string,
    key: string,
    name: string,
    description?: string | null,
  ): Promise<WriteResult>;
  /*
   * ── two APP-provided operations ──────────────────────────────────────────
   *
   * ⚠ `findUserByEmail` and `findUsersByIds` are NOT defined by this module.
   * They query `auth_user`, which `@kwtech/module-auth` owns, guarded by a key
   * this module owns — so neither module can host them and the APP does (see
   * apps/web-server/src/users/). This client names them by CONVENTION, the same
   * way `DEFAULT_GRAPHQL_PATH` names a route module-auth mounts.
   *
   * An app that adopts this module without defining them gets a members screen
   * that still works and shows raw ids: every caller below FAILS SOFT. That is
   * the price of the convention, and it is paid where a reader can see it
   * rather than in a blank page.
   */

  /**
   * Turns an email into the id every member write needs.
   *
   * Exact match, one address at a time, and null for an unknown one — the
   * lookup is deliberately not a search. See the app's `UsersResolver`.
   */
  findUserByEmail(email: string): Promise<FoundUser | null>;
  /**
   * The people behind a set of ids, for a screen holding membership rows and no
   * names. Returns FEWER rows than asked for when an id has no account — a
   * membership can outlive the account it names.
   */
  findUsersByIds(ids: readonly string[]): Promise<FoundUser[]>;
  addMember(organizationId: string, userId: string): Promise<WriteResult>;
  /**
   * Invites an ADDRESS, which may have no account yet.
   *
   * That is the difference from `addMember`, which needs a userId and therefore
   * needs the person to have signed up already. The server emails the link.
   */
  inviteMember(organizationId: string, email: string, roleId: string | null): Promise<InviteResult>;
  /**
   * Invites an address to the PLATFORM: an app-level role, and no tenant.
   *
   * Distinct from `inviteMember` above because the offer is different, and it
   * takes no organization on purpose — adding somebody to a tenant is that
   * tenant's screen. Both write one `PermInvitation`.
   */
  inviteUser(input: { email: string; appRoleId: string }): Promise<InviteResult>;
  revokeInvitation(organizationId: string, invitationId: string): Promise<WriteResult>;
  /** Accepts for the SIGNED-IN caller. The token authorises; the session says who joins. */
  acceptInvitation(token: string): Promise<WriteResult>;
  removeMember(organizationId: string, userId: string): Promise<WriteResult>;
  assignRole(organizationId: string, userId: string, roleId: string): Promise<WriteResult>;
  revokeRole(organizationId: string, userId: string, roleId: string): Promise<WriteResult>;
  createWorkspace(organizationId: string, key: string, name: string, description?: string | null): Promise<WriteResult>;
  /** Rename, or change the key. Both are free — nothing references a workspace by key. */
  updateWorkspace(
    organizationId: string,
    workspaceId: string,
    key: string,
    name: string,
    description?: string | null,
  ): Promise<WriteResult>;
  archiveWorkspace(organizationId: string, workspaceId: string): Promise<WriteResult>;
  shareWorkspace(organizationId: string, workspaceId: string, userId: string): Promise<WriteResult>;
  unshareWorkspace(organizationId: string, workspaceId: string, userId: string): Promise<WriteResult>;
  assignWorkspaceRole(
    organizationId: string,
    workspaceId: string,
    userId: string,
    roleId: string,
  ): Promise<WriteResult>;
  revokeWorkspaceRole(
    organizationId: string,
    workspaceId: string,
    userId: string,
    roleId: string,
  ): Promise<WriteResult>;
  /*
   * ── the viewer's own organizations ───────────────────────────────────────
   *
   * The `/organizations/*` area. Everything above answers ACROSS tenants for a
   * platform key; everything here answers about ONE, and resolves for a
   * customer whose only role is inside it. The server side of that difference
   * is `@RequireScope` — see the resolver.
   */

  /** Where the viewer belongs, and as what. Empty is a normal state. */
  listMyOrganizations(): Promise<MyOrganizationView[]>;
  /**
   * One organization, as a member of it sees it.
   *
   * Same shape as `getOrganization`, different key and different level — a
   * platform view and a tenant view of the same facts. Null when it does not
   * exist; a caller with no standing in one that does is REFUSED rather than
   * given null, so the two are not distinguishable from here.
   */
  getMyOrganization(organizationId: string): Promise<OrganizationDetailView | null>;
  /**
   * One workspace, plus the organization members who could be added to it.
   *
   * Refused unless the viewer is IN the workspace — §12.33, enforced by the
   * guard rather than by this call. An organization administrator who is not a
   * member of it gets a denial, which is the model working: they can rename it
   * from the organization's screen without being able to look inside.
   */
  getMyWorkspace(organizationId: string, workspaceId: string): Promise<MyWorkspaceView | null>;
  /**
   * The roles this organization can hand out, for a members picker.
   *
   * Narrowed to what a tenant may actually grant: app-level roles are filtered
   * out server-side, so the dropdown cannot offer `super-admin`. Pass a `level`
   * to narrow further — the workspace screen asks for 'workspace'.
   */
  listMyOrganizationRoles(organizationId: string, level?: string | null): Promise<RoleView[]>;
  /** What this organization is subscribed to. Ended rows included — they are the history. */
  listMyOrganizationSubscriptions(organizationId: string): Promise<SubscriptionView[]>;
  /** Renames the organization the viewer is inside. Both fields, always — see `updateOrganization`. */
  renameMyOrganization(
    organizationId: string,
    key: string,
    name: string,
    description?: string | null,
  ): Promise<WriteResult>;
  /**
   * The viewer leaves. Takes no userId: the subject is the caller, and an id
   * here would be an invitation to pass somebody else's.
   *
   * Refused for the LAST member — an organization with nobody in it is
   * unreachable by anyone.
   */
  leaveOrganization(organizationId: string): Promise<WriteResult>;

  createSubscription(input: SubscriptionInput): Promise<SubscriptionView>;
  /** Status and renewal date only. The target and the plan are fixed at creation. */
  updateSubscription(subscriptionId: string, status: string, currentPeriodEnd: string): Promise<SubscriptionView>;
  endSubscription(subscriptionId: string): Promise<SubscriptionView>;
}

const ROLE_FIELDS = 'id key label level organizationId icon isSystem disabled features';
const PLAN_FIELDS = 'key label isPublic icon archived features limits { limitKey value }';
const SUBSCRIPTION_FIELDS = `id organizationId organizationName workspaceId workspaceName
  planKey planLabel planIcon planArchived status currentPeriodEnd endedAt`;
const WRITE_RESULT = 'changed id replaced';

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

    async listPlans() {
      const data = await graphql<{ permissionPlans: PlanView[] }>(
        `query PermissionPlans { permissionPlans { ${PLAN_FIELDS} } }`,
      );
      return data.permissionPlans;
    },

    async createPlan(input) {
      const data = await graphql<{ createPlan: PlanView }>(
        `mutation CreatePlan($input: PlanDraftInput!) {
           createPlan(input: $input) { ${PLAN_FIELDS} }
         }`,
        { input },
      );
      return data.createPlan;
    },

    async updatePlan(planKey, input) {
      const data = await graphql<{ updatePlan: PlanView }>(
        `mutation UpdatePlan($planKey: String!, $input: PlanDraftInput!) {
           updatePlan(planKey: $planKey, input: $input) { ${PLAN_FIELDS} }
         }`,
        { planKey, input },
      );
      return data.updatePlan;
    },

    async setPlanArchived(planKey, archived) {
      const data = await graphql<{ setPlanArchived: PlanView }>(
        `mutation SetPlanArchived($planKey: String!, $archived: Boolean!) {
           setPlanArchived(planKey: $planKey, archived: $archived) { ${PLAN_FIELDS} }
         }`,
        { planKey, archived },
      );
      return data.setPlanArchived;
    },

    async previewPlanClone({ sourcePlanKey, current, mode }) {
      const data = await graphql<{ previewPlanClone: ClonePreview }>(
        `mutation PreviewPlanClone($sourcePlanKey: String!, $mode: String!, $current: [String!]!) {
           previewPlanClone(sourcePlanKey: $sourcePlanKey, mode: $mode, current: $current) {
             features added skipped { key reason }
           }
         }`,
        { sourcePlanKey, mode, current: [...current] },
      );
      return data.previewPlanClone;
    },

    async listSubscriptions(organizationId = null) {
      const data = await graphql<{ permissionSubscriptions: SubscriptionView[] }>(
        `query PermissionSubscriptions($organizationId: String) {
           permissionSubscriptions(organizationId: $organizationId) { ${SUBSCRIPTION_FIELDS} }
         }`,
        { organizationId },
      );
      return data.permissionSubscriptions;
    },

    async listOrganizations() {
      const data = await graphql<{ permissionOrganizations: OrganizationView[] }>(
        `query PermissionOrganizations {
           permissionOrganizations {
             id key name description memberCount workspaceCount
             workspaces { id key name }
           }
         }`,
      );
      return data.permissionOrganizations;
    },

    async getOrganization(organizationId) {
      const data = await graphql<{ permissionOrganizationDetail: OrganizationDetailView | null }>(
        `query PermissionOrganizationDetail($organizationId: String!) {
           permissionOrganizationDetail(organizationId: $organizationId) {
             id key name description
             invitations {
               id email state expiresAt createdAt acceptedAt revokedAt
               invitedByUserId acceptedByUserId
               role { id key label level icon }
             }
             workspaces {
               id key name description archived memberCount
               members { workspaceMemberId membershipId userId roles { id key label level icon } }
             }
             members {
               membershipId userId status joinedAt workspaceIds
               roles { id key label level icon }
             }
           }
         }`,
        { organizationId },
      );
      return data.permissionOrganizationDetail;
    },

    async listMyOrganizations() {
      const data = await graphql<{ myOrganizations: MyOrganizationView[] }>(
        `query MyOrganizations {
           myOrganizations {
             userId organizationId organizationKey organizationName organizationDescription
             roleKey roleLabel roleIcon
           }
         }`,
      );
      return data.myOrganizations;
    },

    async getMyOrganization(organizationId) {
      const data = await graphql<{ myOrganization: OrganizationDetailView | null }>(
        // The same selection as `getOrganization` above, against the tenant
        // query. Written out rather than shared through a constant because the
        // two are allowed to diverge — one is a platform screen and one is a
        // customer's — and a shared string would make the first divergence look
        // like a mistake.
        `query MyOrganization($organizationId: String!) {
           myOrganization(organizationId: $organizationId) {
             id key name description
             invitations {
               id email state expiresAt createdAt acceptedAt revokedAt
               invitedByUserId acceptedByUserId
               role { id key label level icon }
             }
             workspaces {
               id key name description archived memberCount
               members { workspaceMemberId membershipId userId roles { id key label level icon } }
             }
             members {
               membershipId userId status joinedAt workspaceIds
               roles { id key label level icon }
             }
           }
         }`,
        { organizationId },
      );
      return data.myOrganization;
    },

    async getMyWorkspace(organizationId, workspaceId) {
      const data = await graphql<{ myWorkspace: MyWorkspaceView | null }>(
        `query MyWorkspace($organizationId: String!, $workspaceId: String!) {
           myWorkspace(organizationId: $organizationId, workspaceId: $workspaceId) {
             organizationId organizationKey organizationName
             workspace {
               id key name description archived memberCount
               members { workspaceMemberId membershipId userId roles { id key label level icon } }
             }
             organizationMembers {
               membershipId userId status joinedAt workspaceIds
               roles { id key label level icon }
             }
           }
         }`,
        { organizationId, workspaceId },
      );
      return data.myWorkspace;
    },

    async listMyOrganizationRoles(organizationId, level = null) {
      const data = await graphql<{ myOrganizationRoles: RoleView[] }>(
        `query MyOrganizationRoles($organizationId: String!, $level: String) {
           myOrganizationRoles(organizationId: $organizationId, level: $level) { ${ROLE_FIELDS} }
         }`,
        { organizationId, level },
      );
      return data.myOrganizationRoles;
    },

    async listMyOrganizationSubscriptions(organizationId) {
      const data = await graphql<{ myOrganizationSubscriptions: SubscriptionView[] }>(
        `query MyOrganizationSubscriptions($organizationId: String!) {
           myOrganizationSubscriptions(organizationId: $organizationId) { ${SUBSCRIPTION_FIELDS} }
         }`,
        { organizationId },
      );
      return data.myOrganizationSubscriptions;
    },

    async renameMyOrganization(organizationId, key, name, description = null) {
      const data = await graphql<{ renameMyOrganization: WriteResult }>(
        `mutation RenameMyOrganization($organizationId: String!, $key: String!, $name: String!, $description: String) {
           renameMyOrganization(organizationId: $organizationId, key: $key, name: $name, description: $description) {
             ${WRITE_RESULT}
           }
         }`,
        { organizationId, key, name, description },
      );
      return data.renameMyOrganization;
    },

    async leaveOrganization(organizationId) {
      const data = await graphql<{ leaveOrganization: WriteResult }>(
        `mutation LeaveOrganization($organizationId: String!) {
           leaveOrganization(organizationId: $organizationId) { ${WRITE_RESULT} }
         }`,
        { organizationId },
      );
      return data.leaveOrganization;
    },

    async updateOrganization(organizationId, key, name, description = null) {
      const data = await graphql<{ updateOrganization: WriteResult }>(
        `mutation UpdateOrganization($organizationId: String!, $key: String!, $name: String!, $description: String) {
           updateOrganization(organizationId: $organizationId, key: $key, name: $name, description: $description) {
             ${WRITE_RESULT}
           }
         }`,
        { organizationId, key, name, description },
      );
      return data.updateOrganization;
    },

    async createOrganization(key, name, description = null) {
      const data = await graphql<{ createOrganization: WriteResult }>(
        `mutation CreateOrganization($key: String!, $name: String!, $description: String) {
           createOrganization(key: $key, name: $name, description: $description) { ${WRITE_RESULT} }
         }`,
        { key, name, description },
      );
      return data.createOrganization;
    },

    async findUserByEmail(email) {
      const data = await graphql<{ findUserByEmail: FoundUser | null }>(
        `query FindUserByEmail($email: String!) {
           findUserByEmail(email: $email) { id email displayName username }
         }`,
        { email },
      );
      return data.findUserByEmail;
    },

    async findUsersByIds(ids) {
      if (ids.length === 0) return [];
      try {
        const data = await graphql<{ findUsersByIds: FoundUser[] }>(
          `query FindUsersByIds($ids: [String!]!) {
             findUsersByIds(ids: $ids) { id email displayName username }
           }`,
          { ids: [...ids] },
        );
        return data.findUsersByIds;
      } catch {
        /*
         * FAILS SOFT, alone among the calls in this file.
         *
         * This is a DECORATION: it turns ids into names on a screen that is
         * fully usable without it. An app that never defined the query, or a
         * caller without `members:manage`, should get a members list showing
         * ids — not an error page instead of the members list. Every other call
         * here throws, because every other call is the thing the screen is for.
         */
        return [];
      }
    },

    async addMember(organizationId, userId) {
      const data = await graphql<{ addMember: WriteResult }>(
        `mutation AddMember($organizationId: String!, $userId: String!) {
           addMember(organizationId: $organizationId, userId: $userId) { ${WRITE_RESULT} }
         }`,
        { organizationId, userId },
      );
      return data.addMember;
    },

    async inviteUser(input) {
      const data = await graphql<{ inviteUser: InviteResult }>(
        `mutation InviteUser($email: String!, $appRoleId: String!) {
           inviteUser(email: $email, appRoleId: $appRoleId) { invitationId delivered }
         }`,
        { email: input.email, appRoleId: input.appRoleId },
      );
      return data.inviteUser;
    },

    async inviteMember(organizationId, email, roleId) {
      const data = await graphql<{ inviteMember: InviteResult }>(
        `mutation InviteMember($organizationId: String!, $email: String!, $roleId: String) {
           inviteMember(organizationId: $organizationId, email: $email, roleId: $roleId) {
             invitationId
             delivered
           }
         }`,
        { organizationId, email, roleId },
      );
      return data.inviteMember;
    },

    async revokeInvitation(organizationId, invitationId) {
      const data = await graphql<{ revokeInvitation: WriteResult }>(
        `mutation RevokeInvitation($organizationId: String!, $invitationId: String!) {
           revokeInvitation(organizationId: $organizationId, invitationId: $invitationId) { ${WRITE_RESULT} }
         }`,
        { organizationId, invitationId },
      );
      return data.revokeInvitation;
    },

    async acceptInvitation(token) {
      const data = await graphql<{ acceptInvitation: WriteResult }>(
        `mutation AcceptInvitation($token: String!) {
           acceptInvitation(token: $token) { ${WRITE_RESULT} }
         }`,
        { token },
      );
      return data.acceptInvitation;
    },

    async removeMember(organizationId, userId) {
      const data = await graphql<{ removeMember: WriteResult }>(
        `mutation RemoveMember($organizationId: String!, $userId: String!) {
           removeMember(organizationId: $organizationId, userId: $userId) { ${WRITE_RESULT} }
         }`,
        { organizationId, userId },
      );
      return data.removeMember;
    },

    async assignRole(organizationId, userId, roleId) {
      const data = await graphql<{ assignRole: WriteResult }>(
        `mutation AssignRole($organizationId: String!, $userId: String!, $roleId: String!) {
           assignRole(organizationId: $organizationId, userId: $userId, roleId: $roleId) { ${WRITE_RESULT} }
         }`,
        { organizationId, userId, roleId },
      );
      return data.assignRole;
    },

    async revokeRole(organizationId, userId, roleId) {
      const data = await graphql<{ revokeRole: WriteResult }>(
        `mutation RevokeRole($organizationId: String!, $userId: String!, $roleId: String!) {
           revokeRole(organizationId: $organizationId, userId: $userId, roleId: $roleId) { ${WRITE_RESULT} }
         }`,
        { organizationId, userId, roleId },
      );
      return data.revokeRole;
    },

    async createWorkspace(organizationId, key, name, description = null) {
      const data = await graphql<{ createWorkspace: WriteResult }>(
        `mutation CreateWorkspace($organizationId: String!, $key: String!, $name: String!, $description: String) {
           createWorkspace(organizationId: $organizationId, key: $key, name: $name, description: $description) {
             ${WRITE_RESULT}
           }
         }`,
        { organizationId, key, name, description },
      );
      return data.createWorkspace;
    },

    async updateWorkspace(organizationId, workspaceId, key, name, description = null) {
      const data = await graphql<{ updateWorkspace: WriteResult }>(
        `mutation UpdateWorkspace(
           $organizationId: String!, $workspaceId: String!, $key: String!, $name: String!, $description: String
         ) {
           updateWorkspace(
             organizationId: $organizationId, workspaceId: $workspaceId,
             key: $key, name: $name, description: $description
           ) {
             ${WRITE_RESULT}
           }
         }`,
        { organizationId, workspaceId, key, name, description },
      );
      return data.updateWorkspace;
    },

    async archiveWorkspace(organizationId, workspaceId) {
      const data = await graphql<{ archiveWorkspace: WriteResult }>(
        `mutation ArchiveWorkspace($organizationId: String!, $workspaceId: String!) {
           archiveWorkspace(organizationId: $organizationId, workspaceId: $workspaceId) { ${WRITE_RESULT} }
         }`,
        { organizationId, workspaceId },
      );
      return data.archiveWorkspace;
    },

    async shareWorkspace(organizationId, workspaceId, userId) {
      const data = await graphql<{ shareWorkspace: WriteResult }>(
        `mutation ShareWorkspace($organizationId: String!, $workspaceId: String!, $userId: String!) {
           shareWorkspace(organizationId: $organizationId, workspaceId: $workspaceId, userId: $userId) {
             ${WRITE_RESULT}
           }
         }`,
        { organizationId, workspaceId, userId },
      );
      return data.shareWorkspace;
    },

    async unshareWorkspace(organizationId, workspaceId, userId) {
      const data = await graphql<{ unshareWorkspace: WriteResult }>(
        `mutation UnshareWorkspace($organizationId: String!, $workspaceId: String!, $userId: String!) {
           unshareWorkspace(organizationId: $organizationId, workspaceId: $workspaceId, userId: $userId) {
             ${WRITE_RESULT}
           }
         }`,
        { organizationId, workspaceId, userId },
      );
      return data.unshareWorkspace;
    },

    async assignWorkspaceRole(organizationId, workspaceId, userId, roleId) {
      const data = await graphql<{ assignWorkspaceRole: WriteResult }>(
        `mutation AssignWorkspaceRole($organizationId: String!, $workspaceId: String!, $userId: String!, $roleId: String!) {
           assignWorkspaceRole(
             organizationId: $organizationId, workspaceId: $workspaceId, userId: $userId, roleId: $roleId
           ) { ${WRITE_RESULT} }
         }`,
        { organizationId, workspaceId, userId, roleId },
      );
      return data.assignWorkspaceRole;
    },

    async revokeWorkspaceRole(organizationId, workspaceId, userId, roleId) {
      const data = await graphql<{ revokeWorkspaceRole: WriteResult }>(
        `mutation RevokeWorkspaceRole($organizationId: String!, $workspaceId: String!, $userId: String!, $roleId: String!) {
           revokeWorkspaceRole(
             organizationId: $organizationId, workspaceId: $workspaceId, userId: $userId, roleId: $roleId
           ) { ${WRITE_RESULT} }
         }`,
        { organizationId, workspaceId, userId, roleId },
      );
      return data.revokeWorkspaceRole;
    },

    async createSubscription(input) {
      const data = await graphql<{ createSubscription: SubscriptionView }>(
        `mutation CreateSubscription($input: SubscriptionDraftInput!) {
           createSubscription(input: $input) { ${SUBSCRIPTION_FIELDS} }
         }`,
        { input },
      );
      return data.createSubscription;
    },

    async updateSubscription(subscriptionId, status, currentPeriodEnd) {
      const data = await graphql<{ updateSubscription: SubscriptionView }>(
        `mutation UpdateSubscription($subscriptionId: String!, $status: String!, $currentPeriodEnd: String!) {
           updateSubscription(
             subscriptionId: $subscriptionId
             status: $status
             currentPeriodEnd: $currentPeriodEnd
           ) { ${SUBSCRIPTION_FIELDS} }
         }`,
        { subscriptionId, status, currentPeriodEnd },
      );
      return data.updateSubscription;
    },

    async endSubscription(subscriptionId) {
      const data = await graphql<{ endSubscription: SubscriptionView }>(
        `mutation EndSubscription($subscriptionId: String!) {
           endSubscription(subscriptionId: $subscriptionId) { ${SUBSCRIPTION_FIELDS} }
         }`,
        { subscriptionId },
      );
      return data.endSubscription;
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
