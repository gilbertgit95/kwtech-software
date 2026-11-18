import { PLATFORM_BILLING_ORGANIZATION_KEYS } from '@kwtech/module-platform-billing';
import { APP_ROLES } from '../src/seed/app-roles.js';
import { PLANS } from '../src/seed/plans.js';
import { ALL_FEATURES } from '../src/seed/registry.js';

/**
 * ⚠ EVERY TENANT PERMISSION HAS A ROLE, AND ROLES AND PLANS AGREE (#172, part of #25).
 *
 * Access is grants FILTERED BY entitlements: a role says "may", the
 * organization's plan says "has bought". Below app level a key needs BOTH, so
 * the catalogue can go wrong three ways that no single check sees, because
 * each half looks fine on its own:
 *
 *   a key no tenant role holds   nobody in a customer's organization can ever
 *                                use it, however good their plan
 *   a role key no plan includes  the grant does nothing, while the Roles
 *                                screen shows it as held
 *   a plan key no role holds     the plan sells something nobody can use
 *
 * These read the REAL seeded roles and plans and the composed registry, as
 * `catalogue-levels.test.ts` does for levels, so a hurried edit to either file
 * fails here by key instead of reaching a shop as a button nobody can press.
 *
 * ## What is held by nobody but Super admin
 *
 * Powers over the whole platform or all of its data, kept from every staff
 * role on purpose (#175). They ARE listed one by one, unlike before staff roles
 * existed: a new app key now has to be either given to a staff role or added
 * here, and either is a decision someone makes in the diff.
 *
 * Plan-exempt keys (billing's organization keys, D13) work without a plan, so
 * they need no plan to count as entitled.
 */

const SUPER_ADMIN = 'super-admin';
const SUPER_ADMIN_ONLY = [
  // The catalogue: what a right, a role and a plan are.
  'features:create',
  'features:import',
  'features:update',
  'features:delete',
  'roles:create',
  'roles:update',
  'roles:disable',
  'roles:manage_app',
  'roles:grant_app',
  'plans:create',
  'plans:update',
  'plans:archive',
  'defaults:manage',
  // Decisions about a customer, not help for one.
  'organizations:manage',
  'users:disable',
  'billing:manage',
  'platform-billing:manage_settings',
  // All of the data, or losing it.
  'backup:download',
  'backup:delete',
  'backup:restore',
];
const tenantRoles = APP_ROLES.filter((role) => role.level !== 'app');
const heldByTenantRoles = new Set(tenantRoles.flatMap((role) => role.features));
const inSomePlan = new Set(PLANS.flatMap((plan) => plan.features));
const planExempt = new Set<string>(PLATFORM_BILLING_ORGANIZATION_KEYS);

describe('every organization and workspace permission is held by a seeded role', () => {
  const tenantKeys = ALL_FEATURES.filter((spec) => spec.level !== 'app');

  it('has tenant keys to check', () => {
    expect(tenantKeys.length).toBeGreaterThan(0);
  });

  it.each(tenantKeys.map((spec) => [spec.key, spec.level]))(
    '%s (%s) is granted by an organization or workspace role',
    (key) => {
      expect(heldByTenantRoles.has(key)).toBe(true);
    },
  );
});

describe('app-level permissions are staff powers, held by app-level roles only', () => {
  const unheld = ALL_FEATURES.filter(
    (spec) => !APP_ROLES.some((role) => role.key !== SUPER_ADMIN && role.features.includes(spec.key)),
  );

  it('leaves to Super admin alone only the platform-wide powers', () => {
    expect(unheld.map((spec) => spec.key).sort()).toEqual([...SUPER_ADMIN_ONLY].sort());
  });

  /*
   * Catches the case the allowance above must not cover: a NEW tenant key that
   * nobody was given. The first describe already fails for it by name; this
   * says why it is not excused.
   */
  it('excuses only app-level keys for being held by Super admin alone', () => {
    expect(unheld.filter((spec) => spec.level !== 'app').map((spec) => spec.key)).toEqual([]);
  });

  it('still gives Super admin every key, so an unheld staff power is always reachable', () => {
    const superAdmin = APP_ROLES.find((role) => role.key === SUPER_ADMIN);
    expect(superAdmin).toBeDefined();
    const missing = ALL_FEATURES.filter((spec) => !superAdmin?.features.includes(spec.key)).map((spec) => spec.key);
    expect(missing).toEqual([]);
  });
});

describe('a role grant below app level is something some plan sells', () => {
  const grants = tenantRoles.flatMap((role) => role.features.map((key) => [role.key, key] as const));

  it.each(grants)('%s: %s is in a plan or works without one', (_role, key) => {
    expect(inSomePlan.has(key) || planExempt.has(key)).toBe(true);
  });
});

describe('what a plan sells, some seeded role can use', () => {
  const sold = PLANS.flatMap((plan) => plan.features.map((key) => [plan.key, key] as const));

  it.each(sold)('%s: %s is held by an organization or workspace role', (_plan, key) => {
    expect(heldByTenantRoles.has(key)).toBe(true);
  });
});
