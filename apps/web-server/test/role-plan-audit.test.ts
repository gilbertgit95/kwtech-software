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
 * ## What is allowed to be held by nobody but Super admin
 *
 * App-level keys: the platform's own staff powers (admin pages, backups,
 * jobs, plans, users, defaults, moderating chat, sending notifications). Roles
 * between Super admin and Normal user are deferred until there are staff to
 * give them to (#25, decided 2026-11-18), so today Super admin, which holds
 * every key, is the only holder. They are not listed one by one: a new admin
 * page adds an app key, and a list would only teach people to append to it.
 *
 * Plan-exempt keys (billing's organization keys, D13) work without a plan, so
 * they need no plan to count as entitled.
 */

const SUPER_ADMIN = 'super-admin';
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
