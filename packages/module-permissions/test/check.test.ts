import {
  canAccessWorkspace,
  checkFeature,
  denialReason,
  explainFeature,
  hasAllFeatures,
  hasAnyFeature,
  hasFeature,
} from '../src/check.js';
import { composeContext } from '../src/domain/grants.js';
import { FEATURE } from '../src/feature-keys.js';
import type { PermissionContext } from '../src/types.js';

/**
 * Denial reasons follow pipeline order: not_granted before not_entitled.
 *
 * That order is a product decision, not a formatting one. A member with no role
 * grant is told to ask an administrator rather than to buy a plan they may not
 * control — and the organization's billing state is not disclosed to everyone
 * who hits a locked button.
 */

const granted = composeContext({
  subjectId: 'u1',
  organizationId: 'org1',
  roles: [{ roleKey: 'admin', level: 'organization', workspaceId: null, features: [FEATURE.membersRead] }],
  plans: [{ planKey: 'pro', workspaceId: null, features: [FEATURE.membersRead] }],
});

/** Granted by a role, absent from the plan. */
const unentitled = composeContext({
  subjectId: 'u1',
  organizationId: 'org1',
  roles: [{ roleKey: 'admin', level: 'organization', workspaceId: null, features: [FEATURE.billingManage] }],
  plans: [{ planKey: 'free', workspaceId: null, features: [] }],
});

/** In the plan, but no role grants it. */
const ungranted = composeContext({
  subjectId: 'u1',
  organizationId: 'org1',
  roles: [],
  plans: [{ planKey: 'pro', workspaceId: null, features: [FEATURE.billingManage] }],
});

describe('checkFeature', () => {
  it('allows a feature that is both granted and entitled', () => {
    expect(checkFeature(granted, FEATURE.membersRead)).toEqual({ allowed: true });
  });

  it('denies with no_context when there is no context at all — fail closed', () => {
    expect(checkFeature(undefined, FEATURE.membersRead)).toEqual({ allowed: false, reason: 'no_context' });
  });

  it('says not_granted when the plan includes it but no role does', () => {
    expect(checkFeature(ungranted, FEATURE.billingManage)).toEqual({ allowed: false, reason: 'not_granted' });
  });

  it('says not_entitled when a role grants it but the plan does not include it', () => {
    expect(checkFeature(unentitled, FEATURE.billingManage)).toEqual({ allowed: false, reason: 'not_entitled' });
  });

  it('reports not_granted, not not_entitled, when BOTH are missing', () => {
    // Otherwise every member of a free-plan organization is told to upgrade for
    // rights their role would never have given them anyway.
    expect(checkFeature(ungranted, FEATURE.rolesUpdate)).toEqual({ allowed: false, reason: 'not_granted' });
  });
});

describe('hasFeature / hasAllFeatures / hasAnyFeature', () => {
  it('hasFeature is the boolean shorthand', () => {
    expect(hasFeature(granted, FEATURE.membersRead)).toBe(true);
    expect(hasFeature(granted, FEATURE.billingManage)).toBe(false);
    expect(hasFeature(undefined, FEATURE.membersRead)).toBe(false);
  });

  it('hasAllFeatures is AND', () => {
    expect(hasAllFeatures(granted, [FEATURE.membersRead])).toBe(true);
    expect(hasAllFeatures(granted, [FEATURE.membersRead, FEATURE.billingManage])).toBe(false);
  });

  it('hasAnyFeature is OR', () => {
    expect(hasAnyFeature(granted, [FEATURE.membersRead, FEATURE.billingManage])).toBe(true);
    expect(hasAnyFeature(granted, [FEATURE.billingManage])).toBe(false);
  });

  it('an empty required list is vacuously true for ALL and false for ANY', () => {
    // The asymmetry is standard set semantics, and it is why <FeatureGate> with
    // no keys must render its fallback rather than lean on hasAllFeatures.
    expect(hasAllFeatures(granted, [])).toBe(true);
    expect(hasAnyFeature(granted, [])).toBe(false);
  });
});

describe('denialReason', () => {
  it('reports no_context ahead of everything', () => {
    expect(denialReason(undefined, [FEATURE.membersRead, FEATURE.billingManage])).toBe('no_context');
  });

  it('reports not_granted ahead of not_entitled across several keys', () => {
    const ctx = composeContext({
      subjectId: 'u1',
      organizationId: 'org1',
      roles: [{ roleKey: 'r', level: 'organization', workspaceId: null, features: [FEATURE.billingManage] }],
      plans: [{ planKey: 'p', workspaceId: null, features: [FEATURE.rolesUpdate] }],
    });

    // billingManage is granted-not-entitled; rolesUpdate is entitled-not-granted.
    expect(denialReason(ctx, [FEATURE.billingManage, FEATURE.rolesUpdate])).toBe('not_granted');
  });

  it('is undefined when nothing was denied', () => {
    expect(denialReason(granted, [FEATURE.membersRead])).toBeUndefined();
  });
});

describe('canAccessWorkspace', () => {
  const withAccess = (ids: string[] | null): PermissionContext => ({ ...granted, accessibleWorkspaceIds: ids });

  it('allows a workspace in the accessible list', () => {
    expect(canAccessWorkspace(withAccess(['ws1']), 'ws1')).toBe(true);
  });

  it('refuses a workspace that is not', () => {
    expect(canAccessWorkspace(withAccess(['ws1']), 'ws2')).toBe(false);
  });

  it('treats null as every workspace', () => {
    expect(canAccessWorkspace(withAccess(null), 'anything')).toBe(true);
  });

  it('refuses with no context', () => {
    expect(canAccessWorkspace(undefined, 'ws1')).toBe(false);
  });

  it('is a separate question from features: access-all does not grant rights', () => {
    const supportish = withAccess(null);
    expect(canAccessWorkspace(supportish, 'ws2')).toBe(true);
    expect(hasFeature(supportish, FEATURE.billingManage)).toBe(false);
  });
});

describe('explainFeature', () => {
  it('names the subscription filter when a role granted it and the plan did not', () => {
    expect(explainFeature(unentitled, FEATURE.billingManage)).toEqual({
      feature: FEATURE.billingManage,
      allowed: false,
      fromAppLevel: false,
      fromScopedRole: true,
      inSubscription: false,
      droppedAt: 'subscription_filter',
    });
  });

  it('names the missing role grant when no role gave it', () => {
    expect(explainFeature(ungranted, FEATURE.billingManage)).toMatchObject({
      allowed: false,
      fromScopedRole: false,
      inSubscription: true,
      droppedAt: 'no_role_grant',
    });
  });

  it('reports inSubscription as null when the app has no subscription model', () => {
    const noPlans = composeContext({
      subjectId: 'u1',
      organizationId: 'org1',
      roles: [{ roleKey: 'r', level: 'organization', workspaceId: null, features: [FEATURE.membersRead] }],
    });

    expect(explainFeature(noPlans, FEATURE.membersRead)).toMatchObject({ allowed: true, inSubscription: null });
  });

  it('marks an app-level grant as exempt rather than as a scoped role', () => {
    const staff = composeContext({
      subjectId: 'u1',
      organizationId: 'org1',
      roles: [{ roleKey: 'support', level: 'app', workspaceId: null, features: [FEATURE.platformSupportAccess] }],
      plans: [],
    });

    expect(explainFeature(staff, FEATURE.platformSupportAccess)).toMatchObject({
      allowed: true,
      fromAppLevel: true,
      fromScopedRole: false,
      inSubscription: false,
    });
  });

  it('sets no droppedAt when allowed', () => {
    expect(explainFeature(granted, FEATURE.membersRead).droppedAt).toBeUndefined();
  });
});
