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
  // ── app level: platform staff, across every organization ────────────────
  /**
   * Enter any organization to help its users. Held by support, not by customers.
   *
   * App-level grants are exempt from plan entitlement (see check.ts): a lapsed
   * organization is precisely when support is needed, so gating staff behind the
   * customer's subscription locks out the people trying to fix it.
   */
  platformSupportAccess: 'platform:support_access',

  /**
   * Read the list of organizations on the platform, and one organization's
   * members and workspaces.
   *
   * APP level, and that is what the key IS: this reads across EVERY tenant, so
   * it is a platform view rather than something an organization grants about
   * itself. A tenant administrator reading their OWN organization is a
   * different question, answered by their membership plus the scope of the
   * request — see PLAN §12.13, still open.
   *
   * Split from `members:manage` for the reason `roles:read` is split from
   * `roles:create`: seeing which tenants exist and changing who is in one are
   * different risks, and support needs the first far more often than the
   * second.
   */
  organizationsRead: 'organizations:read',

  /**
   * Rename an organization — its display name, and the key that names it in a
   * URL.
   *
   * APP level, like `organizations:read` and for the same reason: today the
   * only screen that reaches it is the platform's organization list, which
   * resolves at app level. It is deliberately NOT folded into
   * `organizations:read` — support staff need to look at a tenant constantly
   * and to rename one almost never, and one key for both would hand every
   * support engineer the ability to rename a customer.
   *
   * ⚠ When PLAN §12.13 lands the active-organization scope, this is a
   * candidate to be joined by an organization-level twin so a tenant's own
   * owner can rename their own organization. That is a second key, not a
   * re-levelling of this one: "rename any tenant" and "rename mine" are
   * different rights, and collapsing them would silently give a customer the
   * first.
   */
  organizationsManage: 'organizations:manage',

  /** Invite, remove and re-role people in the organization. */
  membersManage: 'members:manage',
  /** Create, rename and archive workspaces. */
  workspacesManage: 'workspaces:manage',
  /** Share a workspace with another member. */
  workspacesShare: 'workspaces:share',
  /*
   * ── roles ───────────────────────────────────────────────────────────────
   *
   * Split from a single `roles:manage` for the reason `features:author` was
   * split: read, create, update and delete are different risks, and one key
   * meant an organization could not have someone who reviews roles without
   * also letting them rewrite one.
   *
   * READ is ORGANIZATION level; the three WRITES are APP level, and that split
   * is forced by what the write path actually does rather than chosen.
   *
   * `createRole` writes `organizationId: null` — a SHARED PRESET, which the
   * schema defines as "a preset shared by every organization" — and `listRoles`
   * reads that same null scope for everyone. So creating, changing or disabling
   * a role is a PLATFORM operation today: the row it touches is visible to
   * every tenant, and `assertRoleAssignable` lets any organization grant it.
   * Guarding a platform-wide write with an organization-level key would let one
   * tenant's administrator edit a role every other tenant can see.
   *
   * Reading stays organization level, because reading the preset catalogue
   * tells you nothing about any tenant's data — it is the same argument
   * `features:read` makes — and a tenant admin needs it to assign roles.
   *
   * ⚠ This is provisional, and the condition for reversing it is precise: when
   * role writes are scoped to the actor's organization (PLAN §12.13 — the
   * resolver has no active organization on the request, which is exactly why
   * `role-draft.ts` cannot offer an organization picker), these three become
   * genuinely tenant-local and belong back at organization level.
   */
  /** See the roles that exist and what each one grants. */
  rolesRead: 'roles:read',
  /** Define a new role. APP level — every role written is a shared preset. */
  rolesCreate: 'roles:create',
  /**
   * Change what an existing role grants, including cloning another role into it.
   * APP level, for the reason above: the row is shared across every tenant.
   */
  rolesUpdate: 'roles:update',
  /**
   * Disable a role, so it grants nothing — and enable it again.
   *
   * There is deliberately NO delete. A role is referenced by every grant ever
   * made from it, so deleting one either cascades those away — destroying the
   * answer to "what could this person do last March" — or fails on a foreign
   * key at the worst moment. Disabling keeps the row, keeps the history, and is
   * reversible by the person who got it wrong.
   *
   * The same call `PermFeature.deprecatedAt`, `AuthSession.revokedAt` and
   * `PermWorkspace.archivedAt` already make: set a timestamp, never DELETE.
   *
   * APP level. Disabling a shared preset stops it granting for EVERY tenant at
   * once, which is the sharpest form of the mismatch this section describes.
   */
  rolesDisable: 'roles:disable',
  /**
   * Write a role whose own level is APP — required IN ADDITION to create,
   * update or delete.
   *
   * The escalation this closes is specific and not covered by the level rule.
   * `assertRoleFeatureLevels` stops an ORGANIZATION role from collecting
   * app-level features, but nothing stops an organization administrator
   * creating an APP-level role — and an app role applies in every organization
   * and skips the subscription filter entirely. Someone could take the rights
   * they legitimately hold in one tenant and mint a role carrying them across
   * all of them.
   *
   * So the dangerous half is not WHICH features a role carries; it is the
   * role's own level. This key guards exactly that, and nothing else.
   *
   * Still earns its place now that the three writes are app level, and the job
   * has narrowed rather than disappeared: it splits platform staff who may
   * define ORGANIZATION and WORKSPACE presets from those who may mint an
   * APP-level role — which applies in every organization and skips the
   * subscription filter. Without it, anyone able to create a role at all could
   * mint a second super admin.
   */
  rolesManageApp: 'roles:manage_app',
  /**
   * Grant an app-level role TO A PERSON — and take it away again.
   *
   * Separate from `roles:manage_app`, which guards WRITING such a role.
   * Defining "super admin" and handing it to somebody are two different acts
   * with two different blast radii: the first changes what a role means, the
   * second changes what a named person can do this afternoon. A platform can
   * reasonably have somebody who does one and not the other — the same split
   * `roles:read` and `roles:create` already make.
   *
   * It is what `perm_user_role` was missing. The table was readable and nothing
   * wrote it, so the app-level grants in a live database had been inserted by
   * hand (PLAN §12 open decision 37). Two surfaces need it: changing an
   * account's app role from the user administration screens, and choosing the
   * one an invitation will grant.
   *
   * ⚠ The escalation this closes is not the key itself — it is the check beside
   * it. `assignAppRole` refuses a role carrying features the granter does not
   * themselves hold, so holding this cannot be used to mint somebody more
   * powerful than yourself. Without that, one key would be the whole ladder.
   */
  rolesGrantApp: 'roles:grant_app',

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
  /*
   * ── plans: the catalogue ────────────────────────────────────────────────
   *
   * A plan is a named collection of features an organization can BUY, exactly
   * as a role is one a person can be GIVEN — so the keys split the same four
   * ways, for the same reason: read, create, update and retire are different
   * risks, and one `plans:manage` would mean the platform cannot have someone
   * who reviews the catalogue without also being able to rewrite what a paying
   * customer is entitled to.
   *
   * READ is organization level; the other three are APP level. That asymmetry
   * is the same one the feature registry already makes and rests on the same
   * distinction: an administrator inside one tenant has to see what they could
   * subscribe to, while DEFINING what the platform sells is a platform act. A
   * tenant admin who could edit a plan could sell themselves anything.
   */
  /** See the plans that exist and what each one entitles. */
  plansRead: 'plans:read',
  /** Define a new plan and choose what it entitles. */
  plansCreate: 'plans:create',
  /** Change what an existing plan entitles, under everyone already on it. */
  plansUpdate: 'plans:update',
  /**
   * Retire a plan, and bring one back.
   *
   * There is deliberately NO delete, the same call `roles:disable` makes: every
   * subscription ever written points at the plan row, so deleting one either
   * cascades that history away — destroying the answer to "what was this
   * organization entitled to last March" — or fails on a foreign key at the
   * worst moment. Archiving keeps the row and is reversible.
   */
  plansArchive: 'plans:archive',

  // ── subscriptions: who is on what ───────────────────────────────────────
  /**
   * See which plan an organization is on, and when it renews.
   *
   * Its own key rather than part of `billing:manage`, for the reason
   * `roles:read` is separate from `roles:create`: reading what a tenant is
   * subscribed to is what an administrator or a support engineer needs to
   * answer "why can they not do this", and it is not the same right as being
   * able to change it.
   */
  subscriptionsRead: 'subscriptions:read',
  /**
   * Start, change or end a subscription — attach a plan to an organization or
   * one of its workspaces.
   *
   * ENTITLEMENT, not authorisation, and the distinction is the model's: this
   * decides what the organization BOUGHT, while a role decides what a person
   * MAY DO. A feature needs both, which is what lets a denial say "upgrade your
   * plan" or "ask an administrator" rather than one flat refusal — see
   * check.ts.
   *
   * The key predates the subscription screens and was worded "view and change
   * the plan". Viewing is now `subscriptions:read` above; this is the write
   * half, and it is the only key that changes what a tenant is entitled to.
   */
  billingManage: 'billing:manage',
} as const;

export type KnownFeatureKey = (typeof FEATURE)[keyof typeof FEATURE];

export const FEATURE_REGISTRY: readonly FeatureSpec[] = [
  {
    key: FEATURE.featuresRead,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.features],
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
    tags: [FEATURE_TAG.admin, FEATURE_TAG.features],
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
    tags: [FEATURE_TAG.admin, FEATURE_TAG.features],
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
    tags: [FEATURE_TAG.admin, FEATURE_TAG.features],
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
    tags: [FEATURE_TAG.admin, FEATURE_TAG.features],
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
    key: FEATURE.organizationsRead,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.members],
    // APP, not organization: this reads across every tenant. See the key.
    level: 'app',
    label: 'Read organizations',
    description: 'See the organizations on the platform, and one organization’s members and workspaces.',
    isPrivileged: true,
    bindings: [
      { surface: 'ui_route', identifier: '/admin/organizations' },
      { surface: 'graphql_operation', identifier: 'Query.permissionOrganizations' },
      { surface: 'graphql_operation', identifier: 'Query.permissionOrganizationDetail' },
      /*
       * The same disclosure from the other direction — which tenants one
       * PERSON is inside. Bound here rather than to `users:read` because the
       * fact is about the organizations, not about the account.
       */
      { surface: 'graphql_operation', identifier: 'Query.permissionUserOrganizations' },
    ],
  },
  {
    key: FEATURE.organizationsManage,
    module: 'permissions',
    tags: [FEATURE_TAG.admin],
    // APP, like the read key beside it. See the key for why it is separate.
    level: 'app',
    label: 'Rename organizations',
    description: 'Change an organization’s name or key.',
    isPrivileged: true,
    bindings: [{ surface: 'graphql_operation', identifier: 'Mutation.updateOrganization' }],
  },
  {
    key: FEATURE.membersManage,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.members],
    level: 'organization',
    label: 'Manage members',
    description: 'Invite, remove and re-role people in the organization.',
    isPrivileged: true,
    bindings: [
      { surface: 'ui_route', identifier: '/admin/organizations/:organizationId' },
      { surface: 'graphql_operation', identifier: 'Mutation.addMember' },
      { surface: 'graphql_operation', identifier: 'Mutation.removeMember' },
      { surface: 'graphql_operation', identifier: 'Mutation.assignRole' },
      { surface: 'graphql_operation', identifier: 'Mutation.revokeRole' },
      /*
       * The user lookup that turns an email into the id `addMember` needs.
       * It lives in the APP, not in either module: it queries `auth_user` and
       * is guarded by a permissions key, and neither module may import the
       * other. The binding is declared here because this is where the key is
       * declared — see apps/web-server/src/users/.
       */
      { surface: 'graphql_operation', identifier: 'Query.findUserByEmail' },
      // Its batch twin: the members grid holds ids and needs names. Same key,
      // same reason, same place — see apps/web-server/src/users/.
      { surface: 'graphql_operation', identifier: 'Query.findUsersByIds' },
      { surface: 'graphql_operation', identifier: 'Mutation.inviteMember' },
      { surface: 'graphql_operation', identifier: 'Mutation.revokeInvitation' },
      /*
       * `Mutation.acceptInvitation` is deliberately NOT bound to this key, and
       * is deliberately unguarded. The person accepting holds nothing in the
       * organization — that is the point of an invitation — so requiring
       * `members:manage` of them would mean only administrators could accept.
       * The TOKEN is the authorisation, and a signed-in session is still
       * required so the membership is created for the caller rather than for
       * an id somebody supplied.
       */
    ],
  },
  {
    key: FEATURE.workspacesManage,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.workspaces],
    level: 'organization',
    label: 'Manage workspaces',
    description: 'Create, rename and archive workspaces.',
    bindings: [
      { surface: 'graphql_operation', identifier: 'Mutation.createWorkspace' },
      { surface: 'graphql_operation', identifier: 'Mutation.updateWorkspace' },
      { surface: 'graphql_operation', identifier: 'Mutation.archiveWorkspace' },
      { surface: 'ui_route', identifier: '/admin/organizations/:organizationId/workspaces/:workspaceId' },
    ],
  },
  {
    key: FEATURE.workspacesShare,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.workspaces],
    level: 'workspace',
    label: 'Share workspaces',
    description: 'Give another member access to a workspace.',
    bindings: [
      { surface: 'graphql_operation', identifier: 'Mutation.shareWorkspace' },
      { surface: 'graphql_operation', identifier: 'Mutation.unshareWorkspace' },
      { surface: 'graphql_operation', identifier: 'Mutation.assignWorkspaceRole' },
      { surface: 'graphql_operation', identifier: 'Mutation.revokeWorkspaceRole' },
    ],
  },
  {
    key: FEATURE.rolesRead,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.roles],
    level: 'organization',
    label: 'Read roles',
    description: 'See the roles that exist and what each one grants.',
    bindings: [
      { surface: 'ui_route', identifier: '/admin/roles' },
      { surface: 'graphql_operation', identifier: 'Query.permissionRoles' },
      /*
       * Reading which app-level role a person holds. Bound to READ rather than
       * to `roles:grant_app`: seeing that somebody is a super admin is what
       * answers "why can they do that", and it is not the right to change it.
       */
      { surface: 'graphql_operation', identifier: 'Query.permissionUserAppRoles' },
    ],
  },
  {
    key: FEATURE.rolesCreate,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.roles],
    // APP, not organization: every role written is a shared preset visible to
    // every tenant. See the roles section above.
    level: 'app',
    label: 'Create roles',
    description: 'Define a new role and choose what it grants.',
    isPrivileged: true,
    bindings: [
      { surface: 'ui_route', identifier: '/admin/roles/new' },
      { surface: 'graphql_operation', identifier: 'Mutation.createRole' },
    ],
  },
  {
    key: FEATURE.rolesUpdate,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.roles],
    // APP, not organization: every role written is a shared preset visible to
    // every tenant. See the roles section above.
    level: 'app',
    label: 'Update roles',
    description: 'Change what an existing role grants, including cloning another role into it.',
    isPrivileged: true,
    bindings: [
      { surface: 'ui_route', identifier: '/admin/roles/:roleId/edit' },
      { surface: 'graphql_operation', identifier: 'Mutation.updateRole' },
      // Cloning is an UPDATE wearing a different button: it stages a feature
      // list into the form and saves through updateRole, so it is guarded by
      // the same key rather than a key of its own.
      { surface: 'graphql_operation', identifier: 'Mutation.previewRoleClone' },
    ],
  },
  {
    key: FEATURE.rolesDisable,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.roles],
    // APP, not organization: every role written is a shared preset visible to
    // every tenant. See the roles section above.
    level: 'app',
    label: 'Disable roles',
    description: 'Turn a role off so it grants nothing, and turn it back on. Roles are never deleted.',
    isPrivileged: true,
    bindings: [{ surface: 'graphql_operation', identifier: 'Mutation.setRoleDisabled' }],
  },
  {
    key: FEATURE.rolesManageApp,
    module: 'permissions',
    tags: [FEATURE_TAG.platform, FEATURE_TAG.roles],
    level: 'app',
    label: 'Manage app-level roles',
    description: 'Write roles that apply across every organization. Required alongside create, update or delete.',
    isPrivileged: true,
    bindings: [],
  },
  {
    key: FEATURE.rolesGrantApp,
    module: 'permissions',
    tags: [FEATURE_TAG.platform, FEATURE_TAG.roles],
    level: 'app',
    label: 'Grant app-level roles',
    description:
      'Give a person an app-level role, or change the one they hold. Refuses any role carrying more than the granter holds.',
    isPrivileged: true,
    bindings: [
      { surface: 'graphql_operation', identifier: 'Mutation.assignAppRole' },
      /*
       * Inviting somebody with an app-level role attached. The same right as
       * granting one directly — an invitation is a grant that has not landed
       * yet, and guarding it more weakly would make the invite screen the way
       * around the key.
       */
      { surface: 'graphql_operation', identifier: 'Mutation.inviteUser' },
      { surface: 'ui_route', identifier: '/admin/invitations/new' },
    ],
  },
  {
    key: FEATURE.plansRead,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.billing],
    level: 'organization',
    label: 'Read plans',
    description: 'See the plans that exist and what each one entitles.',
    bindings: [
      { surface: 'ui_route', identifier: '/admin/plans' },
      { surface: 'graphql_operation', identifier: 'Query.permissionPlans' },
      /*
       * The first `graphql_subscription` binding in the registry, and the
       * surface has existed since types.ts was written waiting for one.
       *
       * Declared SEPARATELY from the query even though both take `plans:read`,
       * because they are enforced at different moments — the WebSocket
       * handshake versus the request. DESIGN-NOTES is explicit that conflating
       * them "leaves a real hole"; listing both is what makes the claim
       * checkable by `surface-coverage.test.ts` rather than assumed.
       */
      { surface: 'graphql_subscription', identifier: 'Subscription.planChanged' },
    ],
  },
  {
    key: FEATURE.plansCreate,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.billing],
    level: 'app',
    label: 'Create plans',
    description: 'Define a new plan and choose what it entitles.',
    isPrivileged: true,
    bindings: [
      { surface: 'ui_route', identifier: '/admin/plans/new' },
      { surface: 'graphql_operation', identifier: 'Mutation.createPlan' },
    ],
  },
  {
    key: FEATURE.plansUpdate,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.billing],
    level: 'app',
    label: 'Update plans',
    description: 'Change what an existing plan entitles, under everyone already subscribed to it.',
    isPrivileged: true,
    bindings: [
      { surface: 'ui_route', identifier: '/admin/plans/:planKey/edit' },
      { surface: 'graphql_operation', identifier: 'Mutation.updatePlan' },
      // Cloning is an UPDATE wearing a different button: it stages a feature
      // list into the form and saves through updatePlan, so it is guarded by
      // the same key rather than one of its own — exactly as previewRoleClone is.
      { surface: 'graphql_operation', identifier: 'Mutation.previewPlanClone' },
    ],
  },
  {
    key: FEATURE.plansArchive,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.billing],
    level: 'app',
    label: 'Archive plans',
    description: 'Retire a plan so nothing new can subscribe to it, and bring one back. Plans are never deleted.',
    isPrivileged: true,
    bindings: [{ surface: 'graphql_operation', identifier: 'Mutation.setPlanArchived' }],
  },
  {
    key: FEATURE.subscriptionsRead,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.billing],
    level: 'organization',
    label: 'Read subscriptions',
    description: 'See which plan an organization is on, its status and when it renews.',
    bindings: [
      { surface: 'ui_route', identifier: '/admin/subscriptions' },
      { surface: 'graphql_operation', identifier: 'Query.permissionSubscriptions' },
    ],
  },
  {
    key: FEATURE.billingManage,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.billing],
    level: 'organization',
    label: 'Manage billing',
    description: 'Start, change or end an organization or workspace subscription.',
    isPrivileged: true,
    bindings: [
      { surface: 'ui_route', identifier: '/admin/subscriptions/new' },
      { surface: 'ui_route', identifier: '/admin/subscriptions/:subscriptionId/edit' },
      { surface: 'graphql_operation', identifier: 'Mutation.createSubscription' },
      { surface: 'graphql_operation', identifier: 'Mutation.updateSubscription' },
      { surface: 'graphql_operation', identifier: 'Mutation.endSubscription' },
    ],
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
