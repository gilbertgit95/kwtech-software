import type { FeatureSpec } from './types.js';

/**
 * The feature registry — the canonical list of grantable rights.
 *
 * THIS FILE IS THE SOURCE, THE DATABASE IS THE MIRROR. Roles are data and are
 * composed at runtime; features are not, because a key only means something if
 * code checks it. The seed task upserts every entry below and marks anything no
 * longer listed as deprecated — it never deletes, because grants and the audit
 * trail have to stay readable.
 *
 * The registry lives in the module, not in a server app, so the API and the
 * front end import one list instead of mirroring two by hand. A fork between
 * hand-mirrored lists raises no error: it silently hides a control the user is
 * entitled to, or shows one the API will refuse.
 *
 * The API is always the authority. The front end consults these keys only to
 * decide what to SHOW.
 *
 * A key is the smallest thing a user can be given access to, and `bindings`
 * name the concrete places it is enforced. Bindings below are only listed once
 * the guard exists: a binding naming an endpoint nobody wrote reads as coverage
 * in the role editor while guarding nothing. `auditRegistry()` reports the keys
 * still waiting for one.
 *
 * Every key carries the LEVEL a role must be at to grant it, so the role editor
 * can only ever offer a workspace role the features a workspace may decide.
 *
 * Starter vocabulary — expand per area as each is built out.
 */
export const FEATURE = {
  /** Sign in to the internal dashboard. The baseline right inside an organization. */
  adminAccess: 'admin:access',

  // ── app level: platform staff, across every organization ────────────────
  /**
   * Enter any organization to help its users. Held by support, not by customers.
   *
   * App-level grants are exempt from plan entitlement (see check.ts): a lapsed
   * organization is precisely when support is needed, so gating staff behind the
   * customer's subscription locks out the people trying to fix it.
   */
  platformSupportAccess: 'platform:support_access',
  /** Act as a user, for reproducing what they see. Always audited. */
  platformImpersonate: 'platform:impersonate',

  /** Invite, remove and re-role people in the organization. */
  membersManage: 'members:manage',
  /** Create, rename and archive workspaces. */
  workspacesManage: 'workspaces:manage',
  /**
   * See every workspace in the organization without being added to it.
   *
   * Expressed as a right rather than as a structural rule, so "admins see
   * everything" is a role composition an organization can change, not a
   * condition buried in a query.
   */
  workspacesAccessAll: 'workspaces:access_all',
  /** Share a workspace with another member. */
  workspacesShare: 'workspaces:share',
  /** Define roles and choose what they grant. */
  rolesManage: 'roles:manage',
  /** View and change the plan. Entitlement, not authorisation — see check.ts. */
  billingManage: 'billing:manage',
} as const;

export type KnownFeatureKey = (typeof FEATURE)[keyof typeof FEATURE];

export const FEATURE_REGISTRY: readonly FeatureSpec[] = [
  {
    key: FEATURE.adminAccess,
    module: 'permissions',
    level: 'organization',
    label: 'Access the admin app',
    description: 'Sign in to the internal dashboard.',
    bindings: [
      { surface: 'rest_endpoint', identifier: 'GET /permissions/features' },
      { surface: 'ui_route', identifier: '/admin/roles' },
      { surface: 'ui_component', identifier: 'RolesPage' },
    ],
  },
  {
    key: FEATURE.platformSupportAccess,
    module: 'permissions',
    level: 'app',
    label: 'Support access',
    description: 'Enter any organization to help its users.',
    isPrivileged: true,
    bindings: [],
  },
  {
    key: FEATURE.platformImpersonate,
    module: 'permissions',
    level: 'app',
    label: 'Impersonate a user',
    description: 'Act as a user to reproduce what they see. Always audited.',
    isPrivileged: true,
    bindings: [],
  },
  {
    key: FEATURE.membersManage,
    module: 'permissions',
    level: 'organization',
    label: 'Manage members',
    description: 'Invite, remove and re-role people in the organization.',
    isPrivileged: true,
    bindings: [],
  },
  {
    key: FEATURE.workspacesManage,
    module: 'permissions',
    level: 'organization',
    label: 'Manage workspaces',
    description: 'Create, rename and archive workspaces.',
    bindings: [],
  },
  {
    key: FEATURE.workspacesAccessAll,
    module: 'permissions',
    level: 'organization',
    label: 'Access all workspaces',
    description: 'See every workspace in the organization without being added to it.',
    isPrivileged: true,
    bindings: [],
  },
  {
    key: FEATURE.workspacesShare,
    module: 'permissions',
    level: 'workspace',
    label: 'Share workspaces',
    description: 'Give another member access to a workspace.',
    bindings: [],
  },
  {
    key: FEATURE.rolesManage,
    module: 'permissions',
    level: 'organization',
    label: 'Manage roles',
    description: 'Define roles and choose what they grant.',
    isPrivileged: true,
    bindings: [],
  },
  {
    key: FEATURE.billingManage,
    module: 'permissions',
    level: 'organization',
    label: 'Manage billing',
    description: 'View and change the organization plan.',
    isPrivileged: true,
    bindings: [],
  },
] as const;

const REGISTERED = new Set(FEATURE_REGISTRY.map((spec) => spec.key));

/**
 * Guards the seed task and the tests: a key referenced in code but absent from
 * the registry can never be granted, so the check it protects always fails.
 */
export function isRegisteredFeature(key: string): boolean {
  return REGISTERED.has(key);
}
