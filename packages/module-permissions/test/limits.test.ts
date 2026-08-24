import {
  assertPlanLimits,
  checkLimit,
  LIMIT,
  LIMIT_REGISTRY,
  type RoleLimitGrant,
  resolveLimits,
} from '../src/domain/limits.js';

/**
 * Limits are how MANY, features are WHAT. They are checked at different moments
 * — a feature on read, a limit on write — and merging them makes a full
 * organization indistinguishable from an unauthorised one: the user is told
 * "access denied" when the truth is "buy more seats", and the ticket goes to
 * the wrong team.
 *
 * Two sources, never interchangeable: plan-sourced caps come from the
 * subscription, role-sourced ones from the user's app-level role.
 */

const appRole = (limits: Record<string, number>): RoleLimitGrant => ({ level: 'app', limits });

describe('resolveLimits — plan-sourced', () => {
  it('is unrestricted for every plan-sourced key when the app has no subscription model', () => {
    const limits = resolveLimits({});
    expect(limits[LIMIT.organizationMembers]).toBeNull();
    expect(limits[LIMIT.organizationWorkspaces]).toBeNull();
    expect(limits[LIMIT.workspaceMembers]).toBeNull();
  });

  it('falls to the floor of 1 when there is no ACTIVE plan', () => {
    // Not zero. An organization is created before it is subscribed, and a cap of
    // zero stops its founder from being its own first member — sign-up fails
    // before billing is ever reached. One admits exactly the owner.
    const limits = resolveLimits({ plans: [] });
    expect(limits[LIMIT.organizationMembers]).toBe(1);
    expect(limits[LIMIT.organizationWorkspaces]).toBe(1);
    expect(limits[LIMIT.workspaceMembers]).toBe(1);
  });

  it('treats null plans the same as an empty list', () => {
    expect(resolveLimits({ plans: null })).toEqual(resolveLimits({ plans: [] }));
  });

  it('takes the MAX across active plans, matching how grants combine', () => {
    const limits = resolveLimits({
      plans: [
        { planKey: 'a', workspaceId: null, features: [], limits: { [LIMIT.organizationMembers]: 10 } },
        { planKey: 'b', workspaceId: 'ws1', features: [], limits: { [LIMIT.organizationMembers]: 25 } },
      ],
    });

    expect(limits[LIMIT.organizationMembers]).toBe(25);
  });

  it('falls to the floor for a key the active plans do not set — never unlimited by omission', () => {
    const limits = resolveLimits({
      plans: [{ planKey: 'a', workspaceId: null, features: [], limits: { [LIMIT.organizationMembers]: 10 } }],
    });

    expect(limits[LIMIT.organizationMembers]).toBe(10);
    expect(limits[LIMIT.workspaceMembers]).toBe(1);
  });
});

describe('resolveLimits — role-sourced', () => {
  it('defaults user:organizations to 1 when no role assigns one', () => {
    expect(resolveLimits({})[LIMIT.userOrganizations]).toBe(1);
  });

  it('resolves user:organizations even at app level, where no subscription is consulted', () => {
    // The question is asked before any organization exists, so there is no plan
    // to answer it. A null map here made it unanswerable at exactly the moment
    // it is asked.
    const limits = resolveLimits({ roles: [appRole({ [LIMIT.userOrganizations]: 5 })] });
    expect(limits[LIMIT.userOrganizations]).toBe(5);
  });

  it('takes it from APP-level roles only', () => {
    const limits = resolveLimits({
      roles: [
        { level: 'organization', limits: { [LIMIT.userOrganizations]: 99 } },
        { level: 'workspace', limits: { [LIMIT.userOrganizations]: 99 } },
      ],
    });

    expect(limits[LIMIT.userOrganizations]).toBe(1);
  });

  it('does not let a plan set a role-sourced key', () => {
    const limits = resolveLimits({
      plans: [{ planKey: 'a', workspaceId: null, features: [], limits: { [LIMIT.userOrganizations]: 99 } }],
    });

    expect(limits[LIMIT.userOrganizations]).toBe(1);
  });

  it('does not let a role set a plan-sourced key', () => {
    const limits = resolveLimits({ plans: [], roles: [appRole({ [LIMIT.organizationMembers]: 99 })] });
    expect(limits[LIMIT.organizationMembers]).toBe(1);
  });

  it('always returns a map, never null, so both sources resolve through one lookup', () => {
    expect(Object.keys(resolveLimits({})).sort()).toEqual(LIMIT_REGISTRY.map((s) => s.key).sort());
  });
});

describe('checkLimit', () => {
  it('allows while current is below the cap', () => {
    expect(checkLimit({ [LIMIT.organizationMembers]: 3 }, LIMIT.organizationMembers, 2)).toEqual({
      allowed: true,
      limit: 3,
      current: 2,
      remaining: 1,
    });
  });

  it('refuses at the cap', () => {
    expect(checkLimit({ [LIMIT.organizationMembers]: 3 }, LIMIT.organizationMembers, 3)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });

  it('never reports negative headroom when already over', () => {
    // Lowering a plan does not remove existing members; it stops new ones.
    expect(checkLimit({ [LIMIT.organizationMembers]: 3 }, LIMIT.organizationMembers, 7)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });

  it('reports remaining as null, not Infinity, when unrestricted', () => {
    // This crosses a JSON boundary and JSON.stringify(Infinity) is `null`,
    // which a client cannot tell apart from "unknown".
    const decision = checkLimit({ [LIMIT.organizationMembers]: null }, LIMIT.organizationMembers, 100);
    expect(decision).toEqual({ allowed: true, limit: null, current: 100, remaining: null });
    expect(JSON.parse(JSON.stringify(decision)).remaining).toBeNull();
  });

  it('allows on an undeclared key — a limit nobody declared is not a limit', () => {
    expect(checkLimit({}, 'nothing:declared', 1000)).toMatchObject({ allowed: true, limit: null });
  });

  it('allows when there is no map at all', () => {
    expect(checkLimit(null, LIMIT.organizationMembers, 5)).toMatchObject({ allowed: true, limit: null });
  });
});

describe('assertPlanLimits', () => {
  it('refuses a plan that omits a required limit', () => {
    // Otherwise the plan falls back to the floor of 1 and quietly caps a paying
    // customer at a single seat.
    expect(() => assertPlanLimits('pro', { [LIMIT.organizationMembers]: 50 })).toThrow(
      /missing required limits.*organization:workspaces.*workspace:members/,
    );
  });

  it('names the plan in the error', () => {
    expect(() => assertPlanLimits('pro', {})).toThrow(/Plan 'pro'/);
  });

  it('accepts a plan that sets every required limit', () => {
    expect(() =>
      assertPlanLimits('pro', {
        [LIMIT.organizationMembers]: 50,
        [LIMIT.organizationWorkspaces]: 10,
        [LIMIT.workspaceMembers]: 25,
      }),
    ).not.toThrow();
  });

  it('does not require role-sourced limits — most roles say nothing about them', () => {
    expect(() =>
      assertPlanLimits('pro', {
        [LIMIT.organizationMembers]: 50,
        [LIMIT.organizationWorkspaces]: 10,
        [LIMIT.workspaceMembers]: 25,
      }),
    ).not.toThrow();
  });
});

describe('LIMIT_REGISTRY', () => {
  it('has unique keys', () => {
    const keys = LIMIT_REGISTRY.map((spec) => spec.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('floors every limit at 1 or above — nothing is unlimited by omission', () => {
    for (const spec of LIMIT_REGISTRY) {
      expect(spec.defaultValue).not.toBeNull();
      expect(spec.defaultValue as number).toBeGreaterThanOrEqual(1);
    }
  });

  it('marks every plan-sourced limit required, and no role-sourced one', () => {
    for (const spec of LIMIT_REGISTRY) {
      expect(spec.required).toBe(spec.source === 'plan');
    }
  });
});
