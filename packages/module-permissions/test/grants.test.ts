import { type ComposeInput, composeContext, type PlanEntitlement, type RoleGrant } from '../src/domain/grants.js';
import { FEATURE } from '../src/feature-keys.js';

/**
 * The resolution pipeline (PLAN §13, check.ts):
 *
 *   1. combine ORGANIZATION- and WORKSPACE-level role features
 *   2. filter that set against the organization's SUBSCRIPTION
 *   3. union the APP-level features, which skip the filter entirely
 *
 * Order is the design, not an implementation detail. Every test below that says
 * "order" is guarding step 3 happening after step 2 — reversing them turns the
 * app level from an exemption into just another grant, and strips support
 * staff's rights along with everyone else's.
 */

const role = (over: Partial<RoleGrant> & Pick<RoleGrant, 'level' | 'features'>): RoleGrant => ({
  roleKey: `${over.level}-role`,
  workspaceId: null,
  ...over,
});

const plan = (features: string[], over: Partial<PlanEntitlement> = {}): PlanEntitlement => ({
  planKey: 'pro',
  workspaceId: null,
  features,
  ...over,
});

const compose = (over: Partial<ComposeInput> = {}) =>
  composeContext({ subjectId: 'u1', organizationId: 'org1', roles: [], ...over });

describe('composeContext — the subscription filter', () => {
  it('keeps only organization features the plan also includes', () => {
    const ctx = compose({
      roles: [role({ level: 'organization', features: [FEATURE.membersManage, FEATURE.billingManage] })],
      plans: [plan([FEATURE.membersManage])],
    });

    expect(ctx.granted).toEqual([FEATURE.billingManage, FEATURE.membersManage].sort());
    expect(ctx.effective).toEqual([FEATURE.membersManage]);
  });

  it('entitles nothing when there is no active plan — a lapsed organization is not a free one', () => {
    const ctx = compose({
      roles: [role({ level: 'organization', features: [FEATURE.membersManage] })],
      plans: [],
    });

    expect(ctx.entitled).toEqual([]);
    expect(ctx.effective).toEqual([]);
    // The grant is still visible, so a denial can say WHICH step dropped it.
    expect(ctx.granted).toEqual([FEATURE.membersManage]);
  });

  it('applies no filter at all when the app has no subscription model', () => {
    const ctx = compose({
      roles: [role({ level: 'organization', features: [FEATURE.membersManage] })],
      // Absent, not empty: the three states are distinct on purpose.
    });

    expect(ctx.entitled).toBeNull();
    expect(ctx.effective).toEqual([FEATURE.membersManage]);
  });

  it('unions plan features additively — a workspace plan adds to what the organization bought', () => {
    const ctx = compose({
      workspaceId: 'ws1',
      roles: [role({ level: 'organization', features: [FEATURE.membersManage, FEATURE.workspacesManage] })],
      plans: [
        plan([FEATURE.membersManage]),
        plan([FEATURE.workspacesManage], { planKey: 'ws-addon', workspaceId: 'ws1' }),
      ],
    });

    // Not a precedence rule: the workspace plan does not replace the organization's.
    expect(ctx.effective).toEqual([FEATURE.membersManage, FEATURE.workspacesManage].sort());
  });
});

describe('composeContext — app level is an exemption', () => {
  it('grants an app-level feature the plan does not include', () => {
    const ctx = compose({
      roles: [role({ level: 'app', features: [FEATURE.platformSupportAccess] })],
      plans: [], // lapsed customer — exactly when support is needed
    });

    expect(ctx.effective).toContain(FEATURE.platformSupportAccess);
    expect(ctx.grantedAtAppLevel).toEqual([FEATURE.platformSupportAccess]);
  });

  it('unions app level AFTER filtering, so one lapsed plan does not strip staff rights', () => {
    const ctx = compose({
      roles: [
        role({ level: 'app', features: [FEATURE.platformSupportAccess] }),
        role({ level: 'organization', features: [FEATURE.membersManage] }),
      ],
      plans: [],
    });

    // The customer's own grant is filtered out; the staff grant survives.
    expect(ctx.effective).toEqual([FEATURE.platformSupportAccess]);
  });

  it('does not treat a feature held at BOTH levels as filtered', () => {
    const ctx = compose({
      roles: [
        role({ level: 'app', features: [FEATURE.membersManage] }),
        role({ level: 'organization', features: [FEATURE.membersManage] }),
      ],
      plans: [],
    });

    // Same key from two sources: the app-level grant is the one that decides.
    expect(ctx.effective).toEqual([FEATURE.membersManage]);
    expect(ctx.grantedAtAppLevel).toEqual([FEATURE.membersManage]);
  });
});

describe('composeContext — the trigger level decides which roles participate', () => {
  it('answers an app-level request with app-level roles alone', () => {
    const ctx = composeContext({
      subjectId: 'u1',
      organizationId: null,
      roles: [
        role({ level: 'app', features: [FEATURE.platformImpersonate] }),
        role({ level: 'organization', features: [FEATURE.membersManage] }),
        role({ level: 'workspace', features: [FEATURE.workspacesShare], workspaceId: 'ws1' }),
      ],
    });

    // The organization role is not "also true" here — it is unasked, because
    // the request named no organization for it to be true about.
    expect(ctx.granted).toEqual([FEATURE.platformImpersonate]);
  });

  it('excludes workspace roles from an organization-wide question', () => {
    const ctx = compose({
      workspaceId: null,
      roles: [role({ level: 'workspace', features: [FEATURE.workspacesShare], workspaceId: 'ws1' })],
    });

    // A null workspace is not a wildcard. Treating it as one is how a scoped
    // grant silently becomes a global one.
    expect(ctx.granted).toEqual([]);
  });

  it('includes only the ACTIVE workspace’s roles', () => {
    const ctx = compose({
      workspaceId: 'ws1',
      roles: [
        role({ level: 'workspace', features: [FEATURE.workspacesShare], workspaceId: 'ws1' }),
        role({ level: 'workspace', features: [FEATURE.billingManage], workspaceId: 'ws2', roleKey: 'other-ws' }),
      ],
    });

    expect(ctx.granted).toEqual([FEATURE.workspacesShare]);
  });

  it('adds organization roles to workspace-level requests', () => {
    const ctx = compose({
      workspaceId: 'ws1',
      roles: [
        role({ level: 'organization', features: [FEATURE.membersManage] }),
        role({ level: 'workspace', features: [FEATURE.workspacesShare], workspaceId: 'ws1' }),
      ],
    });

    expect(ctx.granted).toEqual([FEATURE.membersManage, FEATURE.workspacesShare].sort());
  });
});

describe('composeContext — additive, never subtractive', () => {
  it('collapses duplicates across roles', () => {
    const ctx = compose({
      roles: [
        role({ level: 'organization', features: [FEATURE.membersManage] }),
        role({ level: 'organization', features: [FEATURE.membersManage], roleKey: 'second' }),
      ],
    });

    expect(ctx.granted).toEqual([FEATURE.membersManage]);
  });

  it('has no deny rule: a second role can only ever add', () => {
    const withOne = compose({ roles: [role({ level: 'organization', features: [FEATURE.membersManage] })] });
    const withTwo = compose({
      roles: [
        role({ level: 'organization', features: [FEATURE.membersManage] }),
        role({ level: 'organization', features: [FEATURE.rolesManage], roleKey: 'second' }),
      ],
    });

    for (const feature of withOne.effective) expect(withTwo.effective).toContain(feature);
  });
});

describe('composeContext — accessible workspaces', () => {
  it('unions explicit shares with workspaces the caller holds a role in', () => {
    const ctx = compose({
      workspaceId: 'ws1',
      workspaceIds: ['ws9'],
      roles: [role({ level: 'workspace', features: [FEATURE.workspacesShare], workspaceId: 'ws1' })],
    });

    // A role grant implies access: the alternative was a user holding a role in
    // a workspace the UI said they could not enter, while the API served it.
    expect(ctx.accessibleWorkspaceIds).toEqual(['ws1', 'ws9']);
  });

  it('is null — every workspace — for workspaces:access_all', () => {
    const ctx = compose({ roles: [role({ level: 'organization', features: [FEATURE.workspacesAccessAll] })] });
    expect(ctx.accessibleWorkspaceIds).toBeNull();
  });

  it('is null for platform:support_access, who hold no membership anywhere', () => {
    const ctx = compose({ roles: [role({ level: 'app', features: [FEATURE.platformSupportAccess] })], plans: [] });

    // Without this, enforcing workspace access locks out exactly the people it
    // must not — support staff are in no workspace by construction.
    expect(ctx.accessibleWorkspaceIds).toBeNull();
  });

  it('is an empty array for a member who has been shared nothing — a normal state', () => {
    const ctx = compose({ roles: [role({ level: 'organization', features: [FEATURE.membersManage] })] });
    expect(ctx.accessibleWorkspaceIds).toEqual([]);
  });
});
