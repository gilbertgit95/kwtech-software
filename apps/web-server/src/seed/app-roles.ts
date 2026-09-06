import { AUTH_FEATURE } from '@kwtech/module-auth';
import { LIMIT } from '@kwtech/module-permissions';
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
   * A sprout, where a flower was suggested — the same gentle register, but it
   * MEANS something the flower does not. This role's defining property is that
   * it holds nothing: it is the ground floor, the shape every account starts
   * in. A sprout reads as "starter" and puts it at the bottom of an obvious
   * scale beside a crown; a flower is decoration, and a reader would have to be
   * TOLD what it stood for.
   *
   * It is one word to change here if you prefer the flower — the icon carries
   * no authority, so nothing but the drawing moves.
   */
  icon: 'sprout',
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

/** Runs one organization: its people, its roles, its plan, its workspaces. */
const ORGANIZATION_ADMIN: SystemRoleDefinition = {
  key: 'organization-admin',
  label: 'Organization admin',
  level: 'organization',
  icon: 'shield',
  /*
   * EMPTY until the registry has features that are genuinely about running an
   * organization.
   *
   * It briefly carried `admin:access`, `members:manage`, `billing:manage` and
   * the rest. Those are rights over the ADMIN APP, which is not the same thing
   * as running a tenant — handing them to a preset now would decide, by
   * accident and in a seed file, what an organization administrator is allowed
   * to do, months before anything enforces it.
   *
   * The role exists so the SHAPE is real: three levels, each with an admin and
   * a member, granted through the right table. What it grants is a separate
   * decision, and an empty list is the honest placeholder for one not yet made.
   *
   * When it is filled: `roles:manage_app` must stay OUT. That key exists so an
   * organization administrator can compose roles inside their own tenant and
   * cannot mint an APP-level role, which would apply across every tenant and
   * skip the subscription filter.
   */
  features: [],
  limits: {},
};

/** Signed in, and nothing more. The organization-level counterpart of normal-user. */
const ORGANIZATION_USER: SystemRoleDefinition = {
  key: 'organization-user',
  label: 'Organization user',
  level: 'organization',
  icon: 'users',
  /*
   * EMPTY, like every preset here. It carried `admin:access`, which is the
   * right to open the admin dashboard — a staff concern, not something an
   * ordinary member of a customer organization should hold by default.
   */
  features: [],
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
  icon: 'workspace',
  features: [],
  limits: {},
};

/** A member of one workspace, holding nothing of their own. */
const WORKSPACE_USER: SystemRoleDefinition = {
  key: 'workspace-user',
  label: 'Workspace user',
  level: 'workspace',
  icon: 'user',
  /*
   * EMPTY, like normal-user and for the same reason: membership of a workspace
   * is structural — it comes from PermWorkspaceMember — and this role exists to
   * say "in it, with no rights of their own" rather than to grant anything.
   */
  features: [],
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
 * Two different mechanisms make an owner an owner, and only one is a level:
 *
 *   the ROLE's level    an organization role applies at organization AND
 *                       workspace scope (`composeContext`), so its grants are
 *                       already true inside every workspace of its organization.
 *                       This needs no feature at all.
 *   `workspaces:access_all`
 *                       which workspaces they may ENTER is a granted right, not
 *                       a structural consequence — deliberately, so an
 *                       organization composes it into whichever role it wants.
 *                       Without it an owner reaches workspace scope but only in
 *                       the workspaces they personally joined.
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
  features: [],
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
