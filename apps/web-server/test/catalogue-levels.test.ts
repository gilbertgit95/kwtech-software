import {
  canPlanEntitle,
  canRoleGrant,
  deriveRouteBindings,
  type FeatureSpec,
  type RoleLevel,
} from '@kwtech/module-permissions';
import { permissionsWebModule } from '@kwtech/module-permissions/react';
import { APP_ROLES } from '../src/seed/app-roles.js';
import { PLANS } from '../src/seed/plans.js';
import { ALL_FEATURES } from '../src/seed/registry.js';

/**
 * ⚠ APP-LEVEL FEATURES BELONG TO APP-LEVEL ROLES, AND TO NOTHING ELSE.
 *
 * The module already refuses a violation at three layers — `validatePlanDraft`
 * for the forms, `assertPlanFeatureLevels` for the seed, `assertRoleDefinable`
 * for role writes — and each is unit-tested against a synthetic registry. What
 * none of them covers is THIS PRODUCT'S ACTUAL CATALOGUE: the four plans and
 * seven roles in `src/seed/`, which are edited by hand, are the things a
 * customer is really sold, and are exactly what nobody re-checks after a hurried
 * change.
 *
 * That is the gap these close. They read the real definitions and the composed
 * registry, so adding `roles:manage_app` to a plan tier, or `features:create` to
 * an organization preset, fails here — at build time, naming the key — rather
 * than being caught by a runtime assertion on somebody's next deploy.
 *
 * ## Why an app-level key in a PLAN is wrong
 *
 * Entitlement resolves as `(granted ∩ entitled) ∪ app-level` — the app-level
 * union comes AFTER the filter, so a plan can never gate a staff right. An
 * app-level key in a plan therefore entitles nobody: it is inert, and inert is
 * worse than it sounds. It reads as a sold feature in the catalogue and as
 * coverage in the registry audit, so somebody eventually relies on it.
 *
 * ## Why an app-level key in an ORGANIZATION role is worse
 *
 * Not inert at all. App-level grants skip the subscription filter and apply at
 * every scope, so one reachable through a tenant role would give a customer a
 * right that no plan gates and that follows them into every organization.
 * `assertRoleDefinable` refuses it — and it refused a real attempt during this
 * work, when three `account:*` keys were put into the organization presets.
 *
 * ## The exception, and why it does not need one
 *
 * Some READ-ONLY rights are legitimately used at both levels: reading the role
 * catalogue, or which plan a tenant is on. Those are not exceptions to this rule
 * — they are declared at ORGANIZATION level in the first place, which is what
 * lets a plan sell them and a tenant role hold them. The platform screens that
 * share those same keys are protected by the SCOPE instead: `/admin/*` resolves
 * at app level, where an organization grant does not participate at all.
 *
 * So the rule needs no carve-out. A right a tenant may exercise is declared at
 * the level the tenant has; a right only staff may exercise is app level and
 * reaches no plan and no tenant role.
 */

const byKey = new Map(ALL_FEATURES.map((spec) => [spec.key, spec]));

/** Named rather than looked up inline, so a failure says which key and why. */
const levelOf = (key: string): RoleLevel | undefined => byKey.get(key)?.level;

describe('the seeded PLANS sell nothing at app level', () => {
  it('has plans to check — a broken import would otherwise pass vacuously', () => {
    expect(PLANS.length).toBeGreaterThan(0);
    expect(ALL_FEATURES.length).toBeGreaterThan(0);
  });

  it.each(PLANS.map((plan) => [plan.key, plan] as const))('%s', (_key, plan) => {
    const offending = plan.features
      .map((key) => ({ key, level: levelOf(key) }))
      .filter((entry) => entry.level !== undefined && !canPlanEntitle(entry.level))
      .map((entry) => `${entry.key} (${entry.level})`);

    expect(offending).toEqual([]);
  });

  /**
   * The other half of the same claim: a key no spec declares can never be
   * checked, so a plan carrying one sells something that does not exist.
   * `workspaces:access_all` was exactly this after §12.33 removed it, and it sat
   * in two seeded tiers.
   */
  it.each(PLANS.map((plan) => [plan.key, plan] as const))('%s sells only registered keys', (_key, plan) => {
    expect(plan.features.filter((key) => !byKey.has(key))).toEqual([]);
  });
});

describe('the seeded ROLES collect nothing above their own level', () => {
  it.each(APP_ROLES.map((role) => [`${role.key} (${role.level})`, role] as const))('%s', (_label, role) => {
    const offending = role.features
      .map((key) => ({ key, level: levelOf(key) }))
      .filter((entry) => entry.level !== undefined && !canRoleGrant(role.level, entry.level))
      .map((entry) => `${entry.key} (${entry.level})`);

    expect(offending).toEqual([]);
  });

  it.each(APP_ROLES.map((role) => [role.key, role] as const))('%s grants only registered keys', (_key, role) => {
    expect(role.features.filter((key) => !byKey.has(key))).toEqual([]);
  });

  /**
   * The rule stated from the other direction, because the two are not the same
   * check: the one above lets an app-level ROLE hold anything, which is correct
   * — `super-admin` is derived from the whole registry. This one says no
   * TENANT-level role holds an app-level key, which is the property that
   * actually protects a customer's blast radius.
   */
  it('no organization- or workspace-level role holds an app-level feature', () => {
    const tenantRoles = APP_ROLES.filter((role) => role.level !== 'app');
    expect(tenantRoles.length).toBeGreaterThan(0);

    const offending = tenantRoles.flatMap((role) =>
      role.features.filter((key) => levelOf(key) === 'app').map((key) => `${role.key} → ${key}`),
    );
    expect(offending).toEqual([]);
  });
});

/**
 * A plan selling a key with no surface a TENANT can reach is not dangerous, but
 * it is dead weight — the decorative coverage the registry audit exists to
 * flag, one level up.
 *
 * Reported rather than asserted, because which rights a tier includes is an
 * operator's product decision (§12.26) and this suite is not the place to
 * overrule it. It fails only if the LIST it is checking is empty, so the
 * message keeps appearing until somebody decides.
 */
describe('what the plans sell that no tenant surface reads', () => {
  it('names them, without failing the build', () => {
    /*
     * A key is tenant-reachable when something bound to it resolves at
     * organization or workspace level. `/admin/*` and the unscoped queries
     * resolve at app level, where an organization grant does not participate.
     *
     * ⚠ ROUTE bindings are DERIVED, not declared. `deriveRouteBindings` reads
     * them off the module's descriptors, so a check that looked only at
     * `spec.bindings` misses every key whose surface is a page — which reported
     * `members:read` and `workspaces:read` as unreachable when both have a
     * tenant route. The audit reads both halves and so must this.
     */
    const derived = deriveRouteBindings(permissionsWebModule.routes ?? []);

    const tenantReachable = (spec: FeatureSpec) =>
      [...(spec.bindings ?? []), ...(derived.get(spec.key) ?? [])].some(
        (binding) =>
          binding.identifier.startsWith('/organizations') ||
          binding.identifier.startsWith('Query.my') ||
          binding.identifier.startsWith('Mutation.my') ||
          binding.identifier.startsWith('Mutation.renameMy') ||
          binding.identifier.startsWith('Mutation.leave') ||
          // The two user lookups the APP owns, which the tenant members screen
          // calls to turn membership ids into names.
          binding.identifier.startsWith('Query.findUser') ||
          // Everything a tenant screen writes through, which is scoped by
          // `@RequireScope` rather than by its name.
          /Mutation\.(invite|revokeInvitation|addMember|removeMember|assignRole|revokeRole|createWorkspace|updateWorkspace|archiveWorkspace|shareWorkspace|unshareWorkspace|assignWorkspaceRole|revokeWorkspaceRole)/.test(
            binding.identifier,
          ),
      );

    const inert = [
      ...new Set(
        PLANS.flatMap((plan) => plan.features).filter((key) => {
          const spec = byKey.get(key);
          return spec !== undefined && !tenantReachable(spec);
        }),
      ),
    ].sort();

    if (inert.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `Plans sell ${inert.length} key(s) no tenant-scoped surface reads: ${inert.join(', ')}. ` +
          'They entitle nothing a customer can exercise — decide whether the tiers should keep them.',
      );
    }

    // The assertion is that the CHECK still works, not that the list is empty.
    expect(PLANS.flatMap((plan) => plan.features).length).toBeGreaterThan(0);
  });
});
