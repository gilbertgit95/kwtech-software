import { FEATURE_TAG } from './feature-tags.js';
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

  // ── the feature registry itself ─────────────────────────────────────────
  /**
   * Read the grantable vocabulary.
   *
   * ORGANIZATION level, not app: someone building roles inside one organization
   * has to be able to see what a role can contain. Reading the list tells you
   * nothing about any organization's data — it is the dictionary, not the
   * records.
   */
  featuresRead: 'features:read',
  /*
   * Create, import and update are SEPARATE keys rather than one `features:write`.
   *
   * They are three different risks, not three spellings of one:
   *
   *   create   adds a key nobody holds yet — it grants nothing until a role
   *            picks it up, so the blast radius on the day is zero.
   *   import   adds many at once from a file. Same act, different scale, and
   *            scale is the whole reason someone might want one without the
   *            other.
   *   update   changes what an EXISTING key means, under everyone already
   *            holding it. That is the dangerous one, and lumping it with
   *            create would make the safe right imply the risky one.
   *
   * All app level: a feature is a platform-wide grantable right, so changing
   * the vocabulary is a platform operation. `assertRoleFeatureLevels` refuses
   * any of these inside an organization-level role, which is what stops a
   * tenant administrator inventing a feature that grants anything.
   */
  /** Define one new feature by hand. */
  featuresCreate: 'features:create',
  /** Define many at once from a spreadsheet. */
  featuresImport: 'features:import',
  /** Change an existing feature's definition. */
  featuresUpdate: 'features:update',
  /** Retire a feature. */
  featuresDelete: 'features:delete',
  /** View and change the plan. Entitlement, not authorisation — see check.ts. */
  billingManage: 'billing:manage',
} as const;

export type KnownFeatureKey = (typeof FEATURE)[keyof typeof FEATURE];

export const FEATURE_REGISTRY: readonly FeatureSpec[] = [
  {
    key: FEATURE.adminAccess,
    module: 'permissions',
    tags: [FEATURE_TAG.admin],
    level: 'organization',
    label: 'Access the admin app',
    description: 'Sign in to the internal dashboard.',
    bindings: [
      // The registry endpoints moved to `features:read`, which is what they are
      // actually about. This key is the baseline right to open the admin app.
      { surface: 'ui_route', identifier: '/admin/roles' },
      { surface: 'ui_component', identifier: 'RolesPage' },
    ],
  },
  {
    key: FEATURE.featuresRead,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.accessControl],
    level: 'organization',
    label: 'View the feature registry',
    description: 'See every right a role can grant, and where each one is enforced.',
    /*
     * FOUR surfaces, and all four are really enforced — the two API ones were
     * added when the guards were. The GraphQL query used to be unguarded, so
     * the page was hidden from anyone without this key while the data behind it
     * was not; a binding that names a surface nothing checks is the same lie in
     * the other direction.
     */
    bindings: [
      { surface: 'rest_endpoint', identifier: 'GET /permissions/features' },
      { surface: 'graphql_operation', identifier: 'Query.permissionFeatures' },
      { surface: 'ui_route', identifier: '/admin/features' },
      { surface: 'ui_component', identifier: 'FeaturesPage' },
    ],
  },
  {
    key: FEATURE.featuresCreate,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.accessControl],
    level: 'app',
    label: 'Create features',
    description: 'Define one new feature by hand.',
    isPrivileged: true,
    /*
     * `ui_route` and `ui_component` only. No `rest_endpoint` or
     * `graphql_operation` on any of these four: neither exists, because the
     * screens emit registry source rather than calling an endpoint (see
     * RegistryOutput). Naming a surface that is not there would be worse than
     * naming none — the audit would report coverage for code nobody wrote.
     * Add them WITH the mutation, not before it.
     */
    bindings: [
      { surface: 'ui_route', identifier: '/admin/features/new/manual' },
      { surface: 'ui_component', identifier: 'FeaturesPage.NewButton' },
    ],
  },
  {
    key: FEATURE.featuresImport,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.accessControl],
    level: 'app',
    label: 'Import features',
    description: 'Define many features at once from a spreadsheet.',
    isPrivileged: true,
    bindings: [
      { surface: 'ui_route', identifier: '/admin/features/new/import' },
      { surface: 'ui_component', identifier: 'FeaturesPage.ImportButton' },
    ],
  },
  {
    key: FEATURE.featuresUpdate,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.accessControl],
    level: 'app',
    label: 'Update features',
    description: "Change an existing feature's definition, for everyone already holding it.",
    isPrivileged: true,
    bindings: [
      { surface: 'ui_route', identifier: '/admin/features/:featureId/edit' },
      { surface: 'ui_component', identifier: 'FeaturesPage.EditButton' },
    ],
  },
  {
    key: FEATURE.featuresDelete,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.accessControl],
    level: 'app',
    label: 'Retire features',
    description: 'Remove a feature from the registry. Deprecates rather than deletes, so grants stay readable.',
    isPrivileged: true,
    /*
     * The control is real and gated even though the action behind it is not
     * wired yet — the button is hidden from anyone without this key. That is a
     * genuine `ui_component` surface, not decoration; the endpoint binding
     * arrives when the endpoint does.
     */
    bindings: [{ surface: 'ui_component', identifier: 'FeaturesPage.DeleteButton' }],
  },
  {
    key: FEATURE.platformSupportAccess,
    module: 'permissions',
    tags: [FEATURE_TAG.platform, FEATURE_TAG.support],
    level: 'app',
    label: 'Support access',
    description: 'Enter any organization to help its users.',
    isPrivileged: true,
    bindings: [],
  },
  {
    key: FEATURE.platformImpersonate,
    module: 'permissions',
    tags: [FEATURE_TAG.platform, FEATURE_TAG.support],
    level: 'app',
    label: 'Impersonate a user',
    description: 'Act as a user to reproduce what they see. Always audited.',
    isPrivileged: true,
    bindings: [],
  },
  {
    key: FEATURE.membersManage,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.members],
    level: 'organization',
    label: 'Manage members',
    description: 'Invite, remove and re-role people in the organization.',
    isPrivileged: true,
    bindings: [],
  },
  {
    key: FEATURE.workspacesManage,
    module: 'permissions',
    tags: [FEATURE_TAG.workspaces],
    level: 'organization',
    label: 'Manage workspaces',
    description: 'Create, rename and archive workspaces.',
    bindings: [],
  },
  {
    key: FEATURE.workspacesAccessAll,
    module: 'permissions',
    tags: [FEATURE_TAG.workspaces],
    level: 'organization',
    label: 'Access all workspaces',
    description: 'See every workspace in the organization without being added to it.',
    isPrivileged: true,
    bindings: [],
  },
  {
    key: FEATURE.workspacesShare,
    module: 'permissions',
    tags: [FEATURE_TAG.workspaces],
    level: 'workspace',
    label: 'Share workspaces',
    description: 'Give another member access to a workspace.',
    bindings: [],
  },
  {
    key: FEATURE.rolesManage,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.accessControl],
    level: 'organization',
    label: 'Manage roles',
    description: 'Define roles and choose what they grant.',
    isPrivileged: true,
    bindings: [],
  },
  {
    key: FEATURE.billingManage,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.billing],
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
