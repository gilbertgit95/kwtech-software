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
   * request — which is `organization:read` below, added when PLAN §12.13
   * closed on 2026-09-09.
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
   * That twin now exists: `organization:manage`, added when PLAN §12.13
   * closed on 2026-09-09, so a tenant's own owner can rename their own
   * organization. A SECOND key, not a re-levelling of this one — "rename any
   * tenant" and "rename mine" are different rights, and collapsing them would
   * silently have given a customer the first.
   */
  organizationsManage: 'organizations:manage',

  // ── organization level: a tenant looking after ITSELF ────────────────────
  //
  // ⚠ THE SINGULAR IS THE TENANT'S, THE PLURAL IS THE PLATFORM'S.
  //
  //   organizations:read    APP    — see EVERY tenant. Support, billing ops.
  //   organization:read     ORG    — see THIS one. A customer's own people.
  //
  // Two keys one letter apart is a hazard, and it is worth the hazard: the
  // alternative is one key that means "any tenant" to a support engineer and
  // "mine" to a customer, which cannot be granted separately and therefore
  // cannot be refused separately. PLAN §12.13's own entry predicted this pair
  // and predicted the second key rather than a re-levelling of the first.
  //
  // The mistake to watch for is granting the PLURAL in an organization-level
  // role. It cannot happen: a role may only collect features at its own level,
  // so `organizations:read` is unofferable to an organization role and the
  // draft validator refuses it. That check is what makes the near-collision
  // safe rather than merely documented.

  /**
   * See this organization — its overview, its people, its workspaces.
   *
   * ORGANIZATION level, which is the whole content of the key: it answers
   * "may this person look at the tenant they are standing in", and the tenant
   * they are standing in comes from the URL (`/organizations/:organizationId`),
   * parsed by scope.ts. There is no id in the grant, so it cannot leak sideways
   * — holding it says nothing about any organization but the one being asked
   * about.
   *
   * ## Why membership alone is not enough
   *
   * It would have been the smaller change, and §12.23 argues for it: a surface
   * gets a key only when it needs AUTHORISATION rather than merely a session.
   * But enforcement here is OPT-IN — a resolver with no key is a resolver the
   * guard never runs — so "members only" would have to be re-implemented inside
   * every tenant query, and the first one to forget would be readable by anyone
   * signed in. A key makes the guard the single enforcement point, which is the
   * arrangement every other surface in this module already has.
   *
   * The practical consequence, worth stating: being ADDED to an organization
   * does not by itself let somebody open it. They need a role carrying this
   * key. The seeded tenant roles carry it; a role that does not is a member who
   * can be granted something inside the tenant without being shown the tenant,
   * which is a real configuration and not an accident to design out.
   */
  organizationRead: 'organization:read',

  /**
   * Rename THIS organization — its display name, and the key in its URL.
   *
   * The organization-level twin `organizations:manage` predicted. A customer's
   * owner renaming their own company is not the same right as a support
   * engineer renaming any customer, and the split is what lets a platform grant
   * the second to nobody outside itself.
   *
   * Split from `organization:read` for exactly the reason the app-level pair is
   * split: people read a tenant constantly and rename one almost never, so one
   * key for both would hand every member who can see the organization the
   * ability to rename it.
   */
  organizationUpdate: 'organization:update',

  /*
   * ── the tenant's people, split by RISK ──────────────────────────────────
   *
   * These four were one key, `members:manage`, carrying nine bindings: reading
   * the roster, inviting, revoking an invitation, removing somebody, and
   * changing what they may do. One key meant an organization could not have
   * anybody who administers people without also letting them re-role — which is
   * the escalation-adjacent half — or anybody who can see the roster without
   * being able to empty it.
   *
   * Split for the reason `roles:manage` and `features:author` were split before
   * them: read, add, remove and re-role are different risks, and a role should
   * describe exactly what its holder can do.
   *
   * None implies another. No inheritance anywhere in this registry.
   */

  /**
   * See who is in the organization, and who has been invited.
   *
   * The read half, and the one a role can hold alone: somebody who coordinates
   * people needs the roster far more often than they need to change it. It also
   * gates the two user lookups the app owns — resolving a membership's `userId`
   * to a name is what makes a roster legible, and nothing else needs it.
   */
  membersRead: 'members:read',

  /**
   * Invite an address to join, and withdraw an invitation not yet used.
   *
   * Sending and revoking are ONE key on purpose. Revoking is undoing your own
   * act, reaches only an invitation nobody has accepted, and a role able to
   * invite but not to take it back would make a typo permanent until somebody
   * senior was found.
   *
   * ⚠ It also gates `addMember`, which takes a userId rather than an address.
   * The outcome is the same act — a person is now in this organization — and
   * the only difference is whether they already had an account. Giving the
   * direct path its own key would let a role add people while being unable to
   * invite them, which is a distinction nobody wants and an easy one to grant
   * by accident.
   */
  membersInvite: 'members:invite',

  /**
   * Remove somebody from the organization.
   *
   * Its own key because it is the destructive one: their role grants and
   * workspace memberships go with them by cascade. "May invite, may not remove"
   * is the ordinary shape of a coordinator role, and it is only expressible
   * because this is separate.
   */
  membersRemove: 'members:remove',

  /**
   * Grant or revoke an ORGANIZATION-level role on a member.
   *
   * The escalation-adjacent one, and the reason the split was worth doing: it
   * changes what another person may do, where every other members key changes
   * only who is present. `assignRole` still refuses a role carrying features
   * the granter does not hold, so this cannot mint somebody more powerful than
   * yourself — but holding it at all is a different order of trust from
   * inviting a colleague.
   *
   * Grant and revoke are one key: a member holds at most one organization role,
   * so `assignRole` REPLACES, and revoking is the same act with no replacement.
   */
  membersAssignRole: 'members:assign_role',

  /*
   * ── the tenant's workspaces, split the same way ─────────────────────────
   *
   * `workspaces:manage` described itself as "Create, rename and archive" — three
   * different risks in one key, one of which stops a workspace resolving for
   * everybody inside it.
   *
   * All four are ORGANIZATION level, and that is not an oversight: which
   * workspaces a tenant has is a decision the organization makes, not one a
   * workspace makes about itself. §12.33 is the same idea from the other side —
   * managing a workspace does not require being IN it, because renaming one is
   * not entering it.
   */

  /** See the organization's workspaces, live and archived. */
  workspacesRead: 'workspaces:read',
  /** Create one. Bounded by the plan's `organization:workspaces` cap. */
  workspacesCreate: 'workspaces:create',
  /** Rename one, or change its key or description. */
  workspacesUpdate: 'workspaces:update',
  /**
   * Archive one.
   *
   * Its own key, and the sharpest split here: an archived workspace stops
   * resolving, so nobody can act inside it and no grant made in it applies.
   * There is no delete, which makes this the most destructive act the tenant
   * area has — and the one most obviously not implied by being able to rename.
   */
  workspacesArchive: 'workspaces:archive',

  /*
   * ── inside ONE workspace ────────────────────────────────────────────────
   *
   * ⚠ SINGULAR `workspace:`, where the four above are plural `workspaces:`, and
   * the difference is the LEVEL: the plural ones are the organization's view of
   * its workspaces, these are what somebody may do in the one they are standing
   * in. The same convention as `organization:read` beside `organizations:read`.
   *
   * That is two pairs a letter apart, which is a hazard worth naming — and a
   * safe one, because a role may only collect features its own level reaches.
   * A workspace role is offered none of the plural keys at all, and the draft
   * validator refuses one that names them.
   *
   * These were `workspaces:share`, which bundled adding a member, removing one
   * and granting a role in the workspace.
   */

  /**
   * Open a workspace and see who is in it.
   *
   * WORKSPACE level, so an organization role carries it downward and it applies
   * in every workspace its holder BELONGS to — never in one they do not, which
   * membership alone decides (§12.33).
   */
  workspaceRead: 'workspace:read',
  /** Add somebody already in the organization to this workspace. */
  workspaceMembersAdd: 'workspace:members_add',
  /** Remove somebody from this workspace. They stay in the organization. */
  workspaceMembersRemove: 'workspace:members_remove',
  /**
   * Grant or revoke a WORKSPACE-level role here.
   *
   * One key for both, like its organization-level twin and for the same reason:
   * a workspace member holds at most one role, so granting replaces and
   * revoking is the same act with nothing to replace it with.
   */
  workspaceAssignRole: 'workspace:assign_role',
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
   * role writes are scoped to the actor's organization (PLAN §12.27), these
   * three become genuinely tenant-local and belong back at organization level.
   *
   * The blocker for that is GONE as of 2026-09-09: the active organization is
   * now on the request (§12.13), so `role-draft.ts` could offer an organization
   * picker. It was deliberately not done in the same change — re-levelling
   * three write keys and re-scoping `listRoles` alters what every existing role
   * means, and that does not belong in the commit that revealed it was
   * possible. `myOrganizationRoles` narrows the tenant PICKER meanwhile, which
   * is presentation and not the re-scoping §12.27 asks for.
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
    /*
     * ⚠ APP LEVEL, moved from organization level.
     *
     * Everything bound to it — `/admin/features`, `Query.permissionFeatures`,
     * `GET /permissions/features` — resolves at APP level, so an
     * organization-level grant reached none of it. It was sold by every plan
     * and usable through none.
     *
     * The old reason for organization level was that "someone building roles
     * has to see what a role can contain". That holds, and it is satisfied
     * here: every roles WRITE key is app level too, so anybody editing a role
     * is app level and holds this alongside.
     */
    level: 'app',
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
    key: FEATURE.organizationRead,
    module: 'permissions',
    // The `organization` root, not `admin`: this is the tenant's own area. See
    // the tag's own comment for why the two roots stay apart.
    tags: [FEATURE_TAG.organization, FEATURE_TAG.members],
    // ORGANIZATION, not app — the one letter of difference from
    // `organizations:read` above. See the key.
    level: 'organization',
    label: 'Open this organization',
    description: 'See this organization’s overview, its people and its workspaces.',
    /*
     * NOT privileged. `organizations:read` is, because reading across every
     * tenant is a platform right; this is the ordinary thing a member of one
     * company does, and marking it privileged would put a warning on the key
     * every customer role has to carry.
     */
    bindings: [
      /*
       * No `ui_route` entries here: `deriveRouteBindings` reads them off the
       * module's route descriptors, and repeating them would be a second place
       * to forget. The audit dedupes, so the derived ones are the record.
       */
      { surface: 'graphql_operation', identifier: 'Query.myOrganization' },
      /*
       * `Query.myWorkspace` is NOT here any more: it moved to `workspace:read`
       * when the bundles were split. The scope still does the work membership
       * is for — that query declares `@RequireScope('workspace')`, so
       * `canAccessWorkspace` is checked before any feature question — but
       * opening a workspace is now its own key, held at workspace level, which
       * is what lets a workspace role carry it without carrying the tenant.
       */
      /*
       * Leaving is bound to the key that lets you SEE the organization, not to
       * one of its own. Walking out is not a right a tenant grants — it is the
       * other end of the membership that put you there — so a key for it would
       * be a key an administrator could withhold to keep somebody in. The
       * write path still refuses the last member: an organization with nobody
       * in it is unreachable by anyone, which is the same argument
       * `createOrganization` makes for adding its founder.
       */
      { surface: 'graphql_operation', identifier: 'Mutation.leaveOrganization' },
    ],
  },
  {
    key: FEATURE.organizationUpdate,
    module: 'permissions',
    tags: [FEATURE_TAG.organization],
    level: 'organization',
    label: 'Update this organization',
    description: 'Change this organization’s name, its key, or its description.',
    /*
     * Privileged, where `organization:read` beside it is not. Renaming changes
     * what every member and every link sees, and the key lands in the URL — so
     * it is the one tenant-level key that deserves a second look in the role
     * editor.
     */
    isPrivileged: true,
    bindings: [{ surface: 'graphql_operation', identifier: 'Mutation.renameMyOrganization' }],
  },
  /*
   * ── the tenant's people ──────────────────────────────────────────────────
   *
   * Four keys where there was one. `members:manage` carried nine bindings and
   * could not express "may invite, may not remove" or "may see the roster, may
   * change nothing" — both ordinary shapes for a real role.
   *
   * Every one is ORGANIZATION level, so an organization role holds them, a plan
   * may sell them, and a workspace role is offered none of them.
   */
  {
    key: FEATURE.membersRead,
    module: 'permissions',
    tags: [FEATURE_TAG.organization, FEATURE_TAG.members],
    level: 'organization',
    label: 'Read members',
    description: 'See who is in the organization, and who has been invited.',
    bindings: [
      /*
       * The two user lookups the APP owns. They query `auth_user`, which
       * `@kwtech/module-auth` owns, guarded by a key this module owns — so
       * neither module can host them and the app does. Bound to READ because
       * resolving a membership's id to a name is what makes a roster legible,
       * and nothing about it changes anybody. See apps/web-server/src/users/.
       */
      { surface: 'graphql_operation', identifier: 'Query.findUserByEmail' },
      { surface: 'graphql_operation', identifier: 'Query.findUsersByIds' },
    ],
  },
  {
    key: FEATURE.membersInvite,
    module: 'permissions',
    tags: [FEATURE_TAG.organization, FEATURE_TAG.members],
    level: 'organization',
    label: 'Invite members',
    description: 'Invite an address to join, add somebody who already has an account, and withdraw an invitation.',
    bindings: [
      { surface: 'graphql_operation', identifier: 'Mutation.inviteMember' },
      { surface: 'graphql_operation', identifier: 'Mutation.revokeInvitation' },
      // Same act, different door: `addMember` takes a userId where
      // `inviteMember` takes an address. See the key.
      { surface: 'graphql_operation', identifier: 'Mutation.addMember' },
      /*
       * `Mutation.acceptInvitation` is deliberately NOT bound here, and is
       * deliberately unguarded. The person accepting holds nothing in the
       * organization — that is the point of an invitation — so requiring a key
       * of them would mean only administrators could accept. The TOKEN is the
       * authorisation.
       */
    ],
  },
  {
    key: FEATURE.membersRemove,
    module: 'permissions',
    tags: [FEATURE_TAG.organization, FEATURE_TAG.members],
    level: 'organization',
    label: 'Remove members',
    description: 'Remove somebody from the organization. Their roles and workspace memberships go with them.',
    isPrivileged: true,
    bindings: [{ surface: 'graphql_operation', identifier: 'Mutation.removeMember' }],
  },
  {
    key: FEATURE.membersAssignRole,
    module: 'permissions',
    tags: [FEATURE_TAG.organization, FEATURE_TAG.members, FEATURE_TAG.roles],
    level: 'organization',
    label: 'Assign member roles',
    description: 'Grant or revoke an organization-level role on a member.',
    // The escalation-adjacent one: it changes what another PERSON may do, where
    // every other members key changes only who is present.
    isPrivileged: true,
    bindings: [
      { surface: 'graphql_operation', identifier: 'Mutation.assignRole' },
      { surface: 'graphql_operation', identifier: 'Mutation.revokeRole' },
    ],
  },

  /*
   * ── the tenant's workspaces ──────────────────────────────────────────────
   *
   * All ORGANIZATION level: which workspaces a tenant has is a decision the
   * organization makes, not one a workspace makes about itself. Managing one
   * does not require being IN it — renaming a workspace is not entering it,
   * which is the other side of §12.33.
   */
  {
    key: FEATURE.workspacesRead,
    module: 'permissions',
    tags: [FEATURE_TAG.organization, FEATURE_TAG.workspaces],
    level: 'organization',
    label: 'Read workspaces',
    description: 'See the organization’s workspaces, live and archived.',
    bindings: [],
  },
  {
    key: FEATURE.workspacesCreate,
    module: 'permissions',
    tags: [FEATURE_TAG.organization, FEATURE_TAG.workspaces],
    level: 'organization',
    label: 'Create workspaces',
    description: 'Create a workspace. Bounded by the plan’s workspace cap.',
    bindings: [{ surface: 'graphql_operation', identifier: 'Mutation.createWorkspace' }],
  },
  {
    key: FEATURE.workspacesUpdate,
    module: 'permissions',
    tags: [FEATURE_TAG.organization, FEATURE_TAG.workspaces],
    level: 'organization',
    label: 'Update workspaces',
    description: 'Rename a workspace, or change its key or description.',
    bindings: [{ surface: 'graphql_operation', identifier: 'Mutation.updateWorkspace' }],
  },
  {
    key: FEATURE.workspacesArchive,
    module: 'permissions',
    tags: [FEATURE_TAG.organization, FEATURE_TAG.workspaces],
    level: 'organization',
    label: 'Archive workspaces',
    description: 'Archive a workspace. It stops resolving and nobody can act inside it. There is no delete.',
    isPrivileged: true,
    bindings: [{ surface: 'graphql_operation', identifier: 'Mutation.archiveWorkspace' }],
  },

  /*
   * ── inside ONE workspace ─────────────────────────────────────────────────
   *
   * WORKSPACE level, so an organization role carries them downward and a
   * workspace role carries them alone. They apply only in the workspaces their
   * holder BELONGS to, which membership decides and no role widens (§12.33).
   */
  {
    key: FEATURE.workspaceRead,
    module: 'permissions',
    tags: [FEATURE_TAG.organization, FEATURE_TAG.workspaces],
    level: 'workspace',
    label: 'Open a workspace',
    description: 'Open a workspace you are a member of, and see who else is in it.',
    bindings: [{ surface: 'graphql_operation', identifier: 'Query.myWorkspace' }],
  },
  {
    key: FEATURE.workspaceMembersAdd,
    module: 'permissions',
    tags: [FEATURE_TAG.organization, FEATURE_TAG.workspaces],
    level: 'workspace',
    label: 'Add workspace members',
    description: 'Give somebody already in the organization access to this workspace.',
    bindings: [{ surface: 'graphql_operation', identifier: 'Mutation.shareWorkspace' }],
  },
  {
    key: FEATURE.workspaceMembersRemove,
    module: 'permissions',
    tags: [FEATURE_TAG.organization, FEATURE_TAG.workspaces],
    level: 'workspace',
    label: 'Remove workspace members',
    description: 'Remove somebody from this workspace. They stay in the organization.',
    bindings: [{ surface: 'graphql_operation', identifier: 'Mutation.unshareWorkspace' }],
  },
  {
    key: FEATURE.workspaceAssignRole,
    module: 'permissions',
    tags: [FEATURE_TAG.organization, FEATURE_TAG.workspaces, FEATURE_TAG.roles],
    level: 'workspace',
    label: 'Assign workspace roles',
    description: 'Grant or revoke a workspace-level role here.',
    isPrivileged: true,
    bindings: [
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
      /*
       * The same right, asked from inside ONE organization: which roles may I
       * hand out to a member here. A separate operation from
       * `Query.permissionRoles` rather than an argument on it, because that one
       * answers with `organizationId: null` — the shared-preset scope, which is
       * the platform's whole catalogue — and it resolves at app level, so an
       * organization-level role never participates in it (§12.27). This one
       * declares `@RequireScope('organization')` and narrows to the levels a
       * tenant may actually grant.
       */
      { surface: 'graphql_operation', identifier: 'Query.myOrganizationRoles' },
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
    /*
     * ⚠ APP LEVEL, moved from organization level, for the same reason as
     * `features:read`: `/admin/plans`, `Query.permissionPlans` and
     * `Subscription.planChanged` all resolve at app level.
     *
     * What a TENANT needs is not this — it is `subscriptions:read`, which
     * answers "what am I on" and keeps its organization level because
     * `Query.myOrganizationSubscriptions` and the tenant subscription page are
     * scoped surfaces a customer genuinely reaches.
     */
    level: 'app',
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
      /*
       * The tenant's own copy of the question. `Query.permissionSubscriptions`
       * takes an OPTIONAL organizationId and lists every subscription on the
       * platform when it is omitted, so it cannot be scoped without breaking
       * the admin list that relies on that. This one requires the id, declares
       * `@RequireScope('organization')`, and therefore lets an
       * organization-level role answer it for its own tenant and nobody else's.
       */
      { surface: 'graphql_operation', identifier: 'Query.myOrganizationSubscriptions' },
    ],
  },
  {
    key: FEATURE.billingManage,
    module: 'permissions',
    tags: [FEATURE_TAG.admin, FEATURE_TAG.billing],
    /*
     * ⚠ APP LEVEL, and it moved here from organization level.
     *
     * It is a WRITE — start, change or end a subscription — and every other
     * write of that kind (`roles:*`, `features:*`, `plans:*`) is app level.
     * More concretely: none of the three mutations it guards declares a scope,
     * so all three resolve at APP level, and an organization-level grant of it
     * participated in nothing. It was sold by every plan tier and could be
     * exercised by nobody holding it through one.
     *
     * Being app level now, no plan may carry it — `canPlanEntitle` refuses —
     * which is the honest state: changing what a customer is entitled to is a
     * platform act until a billing provider and a tenant-facing surface exist
     * (§12.40). The plan seed's claim that "a customer needs it to upgrade
     * themselves" described an intent the code did not have.
     */
    level: 'app',
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
