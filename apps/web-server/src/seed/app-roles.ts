import { AUTH_FEATURE } from '@kwtech/module-auth';
import { LIMIT } from '@kwtech/module-permissions';
import { type AppRoleDefinition, registryFeatureKeys } from '@kwtech/module-permissions/server';
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
 * The upsert itself lives in the module — see `upsertAppRole`. Definitions here,
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
const SUPER_ADMIN: AppRoleDefinition = {
  key: 'super-admin',
  label: 'Super admin',
  level: 'app',
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
 * A customer account, as opposed to platform staff.
 *
 * Grants nothing: a client's rights come entirely from the organization-level
 * roles they hold inside their own organization. It exists so that "is this
 * person staff or a customer" is a row anyone can read, rather than inferred
 * from the absence of a role, and so the organization cap is written down
 * instead of inherited from LIMIT_REGISTRY's floor.
 *
 * Their own account pages need no key either — those require a session, not
 * authorisation. See module-auth's features.ts for where that line is drawn.
 */
/**
 * Managing your own account: edit your profile, add or remove a second factor.
 *
 * Held by EVERY seeded role, so declaring these keys changed no behaviour — a
 * withheld one is a deliberate act, not an oversight. They exist so a genuinely
 * restricted role can be expressed later: an account whose identity is managed
 * elsewhere, or a shared login nobody should be able to re-name.
 *
 * Password change is deliberately absent — see module-auth's features.ts.
 */
const OWN_ACCOUNT = [
  AUTH_FEATURE.accountProfileWrite,
  AUTH_FEATURE.accountTwoFactorEnrol,
  AUTH_FEATURE.accountTwoFactorRemove,
];

const CLIENT: AppRoleDefinition = {
  key: 'client',
  label: 'Client',
  level: 'app',
  features: OWN_ACCOUNT,
  limits: { [LIMIT.userOrganizations]: 5 },
};

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
const NORMAL_USER: AppRoleDefinition = {
  key: 'normal-user',
  label: 'Normal user',
  level: 'app',
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

export const APP_ROLES: readonly AppRoleDefinition[] = [SUPER_ADMIN, CLIENT, NORMAL_USER];

/** Named so the demo-user seeder does not repeat the string. */
export const NORMAL_USER_KEY = NORMAL_USER.key;

/** Named so the grant seeder does not repeat the string. */
export const SUPER_ADMIN_KEY = SUPER_ADMIN.key;
