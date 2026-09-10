import { AUTH_FEATURE } from '@kwtech/module-auth';
import { FEATURE, LIMIT } from '@kwtech/module-permissions';
import { registryFeatureKeys, type SystemRoleDefinition } from '@kwtech/module-permissions/server';
import { ALL_FEATURES } from './registry.js';

/**
 * The app-level system roles THIS product has.
 *
 * Deliberately app-side, where the mechanics that write them are not. Which
 * roles exist, what they are called and what they cap is a product decision: a
 * second app composing `@kwtech/module-permissions` would want different ones,
 * and the module upserting a role called `super-admin` into every database that
 * ever adopted it would be the module deciding something that is not its.
 *
 * The upsert itself lives in the module — see `upsertSystemRole`. Definitions here,
 * mechanism there.
 */

/**
 * All access to all available features.
 *
 * Two properties of the read path make this total access rather than merely a
 * long list (both in the module's domain/grants.ts): app-level grants are
 * unioned in AFTER the subscription filter, and they apply at every scope. So a
 * super admin sees every organization regardless of what that customer bought,
 * or whether their subscription has lapsed at all.
 *
 * Derived from the COMPOSED registry on every run rather than listed, so a key
 * added by any module — not just permissions — is granted on the next sync. A
 * frozen list would leave the role named "super admin" while quietly ceasing to
 * be all-access, found out as a denied request months on.
 */
const SUPER_ADMIN: SystemRoleDefinition = {
  key: 'super-admin',
  label: 'Super admin',
  level: 'app',
  /*
   * A crown: the one role that answers to nobody inside the product. It is the
   * only icon here chosen for RANK rather than for job, which is the honest
   * signal — every other role is a description of what someone does, and this
   * one is a description of what they outrank.
   */
  icon: 'crown',
  features: registryFeatureKeys(ALL_FEATURES),
  /**
   * Role-sourced limits have no "unlimited" value: `resolveLimits` takes the
   * MAX any app role assigns, and falls back to the registry floor of 1 when
   * none does. Without a row here a super admin would be capped at ONE
   * organization — so the cap is set absurdly high rather than left unsaid.
   */
  limits: { [LIMIT.userOrganizations]: 9999 },
};

/**
 * Managing your own account: edit your profile, add or remove a second factor.
 *
 * Held by every seeded role that grants anything at all, so declaring these
 * keys changed no behaviour — a withheld one is a deliberate act, not an
 * oversight. They exist so a genuinely restricted role can be expressed later:
 * an account whose identity is managed elsewhere, or a shared login nobody
 * should be able to re-name.
 *
 * Password change is deliberately absent — see module-auth's features.ts.
 */
const OWN_ACCOUNT = [
  AUTH_FEATURE.accountProfileWrite,
  AUTH_FEATURE.accountTwoFactorEnrol,
  AUTH_FEATURE.accountTwoFactorRemove,
];

/**
 * An ordinary signed-in person, holding NOTHING.
 *
 * Exists to be tested against: with no features at all, every gated surface
 * should refuse and every gated nav entry should be absent. It is the control
 * case for the whole access-checking chain — route guard, page gate, component
 * gate and API guard — and a role that grants nothing is the only one that
 * proves a denial is real rather than incidental.
 *
 * Deliberately overlaps `client`, which also grants nothing. They are kept
 * apart because they answer different questions: `client` says "this account is
 * a customer, not staff", a fact about billing and support; `normal-user` says
 * "this account is here to verify that gating works". Merging them would make a
 * test fixture into a business classification. Drop this one once there are
 * real organization-level roles to test with.
 */
const NORMAL_USER: SystemRoleDefinition = {
  key: 'normal-user',
  label: 'Normal user',
  level: 'app',
  /*
   * ⚠ AN ID CARD, and it was a SPROUT — changed because the sprout was already
   * the `free` plan's icon, and the two are drawn side by side.
   *
   * The organization switcher puts a viewer's ROLE and their organization's
   * PLAN on one line, separated by a middot. A normal user on the free plan
   * therefore rendered the same glyph twice — 🌱 · 🌱 — which reads as a
   * rendering fault rather than as two facts, and the second it does register
   * as two facts it invites the wrong reading: that the role and the plan are
   * the same kind of thing. They are not. A role is given to a PERSON; a plan
   * is bought by an ORGANIZATION (see the twins rule in docs/PLAN.md §9), and
   * an icon shared between them undoes a distinction the model spends real
   * effort keeping.
   *
   * The sprout's argument was that this role is the ground floor, the shape
   * every account starts in — "starter", at the bottom of a scale beside a
   * crown. That reading was good and it is what the FREE PLAN now keeps, where
   * a growth metaphor belongs: a plan is a tier and tiers have a bottom. A role
   * that holds nothing is not a tier; it is an identity with no powers attached
   * to it, which is what an id card draws. It also sits in the same
   * person-shaped family as `user` and `user-cog` below, so the role icons read
   * as one set.
   */
  icon: 'id-card',
  /*
   * EMPTY, and it must stay empty: adding anything — even `admin:access` "just
   * to see the dashboard" — would make every denial this role exists to
   * demonstrate ambiguous.
   *
   * It DOES hold the own-account keys: the point of the role is to have no
   * admin rights, not to be unable to rename itself. A role that withholds
   * those is the future `restricted-user`, and withholding them should be a
   * deliberate act rather than the default.
   */
  features: OWN_ACCOUNT,
  limits: { [LIMIT.userOrganizations]: 5 },
};

/*
 * ── the shared presets ──────────────────────────────────────────────────────
 *
 * Organization- and workspace-level roles with `organizationId: null`, which
 * the schema defines as "a preset shared by every organization" rather than one
 * tenant's own definition. That is what makes them seedable at all: no
 * organization exists yet, and a preset does not need one.
 *
 * They are `isSystem`, so the admin screens will not edit them — a change here
 * is a change in the checkout, and `db:sync` REPLACES what they grant on every
 * run. An edit made in the UI would look saved and be reverted on the next
 * deploy, which is the trap the feature screens already document.
 *
 * Features are listed rather than derived, unlike super-admin. Deriving "every
 * organization-level key" would silently widen these roles the moment a key is
 * added — and an admin preset that grows itself is the opposite of a role that
 * describes what its holder can do.
 */

/*
 * ── THE TENANT PRESETS ARE NO LONGER EMPTY ──────────────────────────────────
 *
 * They were, deliberately, and each said so: "EMPTY until the registry has
 * features that are genuinely about running an organization." That was the
 * right call at the time — every key in the registry was a right over the ADMIN
 * APP, and handing those to a customer's preset would have decided, in a seed
 * file, what an organization administrator may do months before anything
 * enforced it.
 *
 * The `/organizations/*` area is what changed (PLAN §12.13). There is now a
 * vocabulary that is genuinely about running ONE organization —
 * `organization:read` and `organization:manage` — and every surface that reads
 * it resolves at organization or workspace level. Leaving these empty now would
 * mean the tenant screens exist and no customer can open any of them: only
 * `super-admin` would reach them, through the app-level union that exists for
 * support.
 *
 * ## Why granting `roles:read` and `subscriptions:read` here is safe
 *
 * Both also gate `/admin/roles` and `/admin/subscriptions`, which are platform
 * screens. Granting them to an ORGANIZATION-level preset does not open those:
 * `/admin/*` resolves at APP level, and an organization role does not
 * participate at app scope at all. The level is the boundary, and that is why
 * these keys can be shared between a platform screen and a tenant one without a
 * second key per audience.
 *
 * ## What deliberately stays out of all of them
 *
 *   roles:manage_app   app level — `assertRoleDefinable` refuses it outright,
 *                      and that refusal is the point: minting an app-level role
 *                      would carry a tenant's rights across every tenant.
 *   billing:manage     organization level, so it COULD go here. It does not,
 *                      because there is no tenant-facing write surface for it:
 *                      subscriptions are changed on `/admin/subscriptions`, and
 *                      billing is unbuilt (§12.40). A key granting a right with
 *                      nowhere to exercise it is the decorative coverage the
 *                      registry audit exists to prevent. Revisit when a
 *                      provider is chosen.
 *   features:read      the platform's feature registry. An organization-level
 *                      key by accident of where it is checked, not a thing a
 *                      customer has any business reading.
 */

/**
 * Runs one organization: its people, its workspaces, and what it is on.
 *
 * Everything the OWNER holds except renaming the organization. That is the one
 * split worth having between the two: an administrator who manages people and
 * workspaces every day should not also be able to change what the company is
 * called and what appears in its URLs, which every member and every link sees.
 */
const ORGANIZATION_ADMIN: SystemRoleDefinition = {
  key: 'organization-admin',
  label: 'Organization admin',
  level: 'organization',
  icon: 'shield',
  /*
   * ⚠ NO `OWN_ACCOUNT` HERE, unlike the app-level roles above.
   *
   * The three `account:*` keys are APP level — looking after your own account
   * is not something an organization grants — so an organization-level role may
   * not carry them, and `assertRoleDefinable` refuses outright rather than
   * silently dropping them. That refusal is worth having: a preset that
   * quietly ignored three keys would read as granting them.
   *
   * Nobody loses anything by their absence. They are held through the
   * APP-level role every account has, which is where a fact about the person
   * rather than about one company belongs.
   */
  features: [
    FEATURE.organizationRead,

    // People: everything except changing what the organization is CALLED, which
    // is the owner's alone.
    FEATURE.membersRead,
    FEATURE.membersInvite,
    FEATURE.membersRemove,
    FEATURE.membersAssignRole,
    // Needed by the members screen's role picker as well as by the roles list:
    // `myOrganizationRoles` is guarded on it.
    FEATURE.rolesRead,

    // Workspaces, all four: creating, renaming and archiving are what running a
    // tenant's workspaces means.
    FEATURE.workspacesRead,
    FEATURE.workspacesCreate,
    FEATURE.workspacesUpdate,
    FEATURE.workspacesArchive,

    /*
     * WORKSPACE level, carried by an ORGANIZATION role — levels reach downward.
     * They apply inside the workspaces this holder BELONGS to and nowhere else,
     * because membership is what admits them (§12.33). An administrator who is
     * in no workspace can still create and rename them from the organization's
     * own screen, and can do nothing inside one.
     */
    FEATURE.workspaceRead,
    FEATURE.workspaceMembersAdd,
    FEATURE.workspaceMembersRemove,
    FEATURE.workspaceAssignRole,

    FEATURE.subscriptionsRead,
  ],
  limits: {},
};

/**
 * Signed in, a member, and nothing more — the organization-level counterpart of
 * `normal-user`.
 *
 * It holds `organization:read` and that is not a contradiction of what
 * `normal-user` is for. Being a member of a company and being unable to open
 * that company's page at all is not a restricted user, it is a broken one: they
 * would sign in, see their organization in the switcher, and be refused by it.
 * What they cannot do is everything else — no members screen, no workspaces
 * screen, no subscription — which is what makes this the control case it was
 * always meant to be.
 */
const ORGANIZATION_USER: SystemRoleDefinition = {
  key: 'organization-user',
  label: 'Organization user',
  level: 'organization',
  icon: 'users',
  /*
   * `organization:read` and the two READS beside it — enough to open the
   * company, see who is in it and see its workspaces, and to change none of it.
   * That is what an ordinary member is: present, and able to find their way
   * around. No `account:*`, which are app level — see ORGANIZATION_ADMIN.
   */
  features: [FEATURE.organizationRead, FEATURE.membersRead, FEATURE.workspacesRead, FEATURE.workspaceRead],
  limits: {},
};

/**
 * Runs one workspace.
 *
 * EMPTY, and the registry explains why: `workspaces:share` is the only
 * WORKSPACE-level key that exists — `workspaces:access_all` and
 * `workspaces:manage` are both organization-level, because seeing or creating
 * every workspace is a decision the organization makes, not one a single
 * workspace makes about itself. There is not yet a vocabulary for what running
 * a workspace means, so this grants nothing until there is.
 */
const WORKSPACE_ADMIN: SystemRoleDefinition = {
  key: 'workspace-admin',
  label: 'Workspace admin',
  level: 'workspace',
  /*
   * ⚠ A PERSON WITH A COG, and it was the WORKSPACE glyph — changed because
   * that glyph already names the workspace NAV GROUP, and the two appear
   * together.
   *
   * The drawer heads its Workspace section with that icon and the workspace
   * selector draws this role's badge a few pixels above it, so one drawing
   * meant "the place you are in" and "what you are in it" at the same time. A
   * reader cannot tell which, and the failure is quiet: nothing looks broken,
   * the icon simply stops carrying information.
   *
   * A ROLE ICON SHOULD DRAW THE PERSON, NOT THE PLACE. That is the rule the
   * rest of this file follows without having said so — `user` for the workspace
   * member, `users` for the organization admin, a crown for the super admin —
   * and this was the one exception. `user-cog` puts it back in the family and
   * pairs it with `user` below: the same person, one of them able to change
   * things.
   */
  icon: 'user-cog',
  /*
   * `workspaces:share` and nothing else, which is the whole vocabulary a
   * workspace has: it is the only WORKSPACE-level key in the registry, because
   * every other question — creating a workspace, renaming one, who is in the
   * organization — is one the organization answers, not one a single workspace
   * answers about itself.
   *
   * It is what lets somebody add a colleague to THIS workspace and grant them a
   * role there, from `/organizations/:id/workspaces/:wsId`. That page resolves
   * at workspace level, so this grant applies in the workspace the holder is
   * standing in and in no other — the first thing in this codebase for which
   * that is actually true, since nothing resolved a workspace-level request
   * before the tenant screens.
   *
   * It carries no `organization:read`, deliberately. A workspace role that
   * opened the ORGANIZATION would be a workspace deciding something about its
   * parent. In practice its holders also hold an organization role, and that is
   * where the right to open the company comes from.
   */
  features: [
    FEATURE.workspaceRead,
    FEATURE.workspaceMembersAdd,
    FEATURE.workspaceMembersRemove,
    FEATURE.workspaceAssignRole,
  ],
  limits: {},
};

/** A member of one workspace, holding nothing of their own. */
const WORKSPACE_USER: SystemRoleDefinition = {
  key: 'workspace-user',
  label: 'Workspace user',
  level: 'workspace',
  icon: 'user',
  /*
   * `workspace:read` and nothing else. It was empty, and that was right while
   * opening a workspace took no key — membership is structural, from
   * PermWorkspaceMember, and this role existed to say "in it, with no rights of
   * their own".
   *
   * The atomic split gave opening one its own key, so an empty role would now
   * mean a member who is in a workspace and cannot open it. Read is what "in
   * it, with no rights of their own" has to carry.
   */
  features: [FEATURE.workspaceRead],
  limits: {},
};

/**
 * Owns one organization. EMPTY, like every other preset here.
 *
 * It briefly carried all ten features an organization-level role can reach.
 * Those are rights over the ADMIN APP — billing, the feature registry, roles,
 * members — which is not the same thing as owning an organization. Handing them
 * to a preset now would decide, in a seed file and by accident, what an owner is
 * allowed to do, long before anything enforces it.
 *
 * The role exists so the SHAPE is real. What it grants is a separate decision,
 * and an empty list is the honest placeholder for one not yet made.
 *
 * ## What to give it, when organization features exist
 *
 * An organization role applies at organization AND workspace scope
 * (`composeContext`), so its grants are already true inside every workspace its
 * holder BELONGS TO. That needs no feature at all.
 *
 * ⚠ It does not let them into workspaces they were never added to. Workspace
 * membership is required and no role widens it (docs/PLAN.md §13, 2026-09-07) —
 * `workspaces:access_all` used to be that route and has been removed. An owner
 * who should see every workspace is added to every workspace, which is one
 * mechanism instead of two and leaves "why can they see this" with one answer.
 *
 * Levels now reach downward, so an organization role may also carry
 * workspace-level keys such as `workspaces:share`. It may NEVER carry
 * `roles:manage_app`, which is app level — `assertRoleDefinable` refuses it,
 * and that refusal is the point: minting an app-level role would let a tenant
 * administrator carry their own organization's rights across every tenant.
 */
const ORGANIZATION_OWNER: SystemRoleDefinition = {
  key: 'organization-owner',
  label: 'Organization owner',
  level: 'organization',
  icon: 'organization',
  /*
   * The admin's list plus `organization:manage` — the right to rename the
   * company and change the key in its URLs.
   *
   * That is the ORGANIZATION-level key, one letter from the app-level
   * `organizations:manage` that lets support rename ANY tenant. The two are
   * separate on purpose and neither stands in for the other; an organization
   * role could not carry the app-level one even if this file asked it to,
   * because a role may only collect features at its own level.
   */
  features: [...ORGANIZATION_ADMIN.features, FEATURE.organizationUpdate],
  limits: {},
};

export const APP_ROLES: readonly SystemRoleDefinition[] = [
  SUPER_ADMIN,
  NORMAL_USER,
  ORGANIZATION_OWNER,
  ORGANIZATION_ADMIN,
  ORGANIZATION_USER,
  WORKSPACE_ADMIN,
  WORKSPACE_USER,
];

/** Named so the demo-user seeder does not repeat the string. */
export const NORMAL_USER_KEY = NORMAL_USER.key;

/** Named so the grant seeder does not repeat the string. */
export const SUPER_ADMIN_KEY = SUPER_ADMIN.key;
