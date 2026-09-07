import { type ComposeInput, composeContext, type PlanEntitlement, type RoleGrant } from '../src/domain/grants.js';
import { allFeatureKeys } from '../src/domain/roles.js';
import { FEATURE, FEATURE_REGISTRY } from '../src/feature-keys.js';

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
        role({ level: 'app', features: [FEATURE.featuresCreate] }),
        role({ level: 'organization', features: [FEATURE.membersManage] }),
        role({ level: 'workspace', features: [FEATURE.workspacesShare], workspaceId: 'ws1' }),
      ],
    });

    // The organization role is not "also true" here — it is unasked, because
    // the request named no organization for it to be true about.
    expect(ctx.granted).toEqual([FEATURE.featuresCreate]);
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
        role({ level: 'organization', features: [FEATURE.rolesUpdate], roleKey: 'second' }),
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

  /**
   * WORKSPACE MEMBERSHIP IS REQUIRED, and this is the assertion that says so.
   *
   * `workspaces:access_all` used to widen this and has been removed from the
   * registry — a second route into a workspace is a second thing to check, a
   * second thing to revoke, and a second answer to "why can they see this". It
   * was also the one feature that bypassed plan entitlement, because this reads
   * `granted` rather than `effective`.
   *
   * An organization role now reaches INTO the workspaces its holder belongs to,
   * and no further.
   */
  it('is NOT widened by any organization role — membership is the only route', () => {
    const ctx = compose({
      roles: [role({ level: 'organization', features: [FEATURE.membersManage, FEATURE.workspacesManage] })],
      workspaceIds: ['ws1'],
    });

    expect(ctx.accessibleWorkspaceIds).toEqual(['ws1']);
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

describe('composeContext — a super admin holding the whole registry', () => {
  /**
   * The seeded `super-admin` role, as the read path sees it: one app-level
   * grant carrying every key in FEATURE_REGISTRY.
   *
   * These tests are the reason the level rule was relaxed for app roles. They
   * assert the property the role is named for — that nothing an organization
   * does, buys or fails to buy can take a right away from platform staff.
   */
  const superAdmin = role({
    roleKey: 'super-admin',
    level: 'app',
    features: allFeatureKeys(FEATURE_REGISTRY),
    limits: { 'user:organizations': 9999 },
  });

  it('overrides the subscription — every feature survives an empty plan list', () => {
    const ctx = compose({ roles: [superAdmin], plans: [] });

    // No active plan entitles nothing, and a member with these same rights via
    // organization roles would come out with nothing at all. Step 3 unions the
    // app level in after the filter, so all of it survives.
    expect(ctx.entitled).toEqual([]);
    expect(ctx.effective).toEqual(allFeatureKeys(FEATURE_REGISTRY));
  });

  it('overrides a plan that entitles a single feature', () => {
    const ctx = compose({ roles: [superAdmin], plans: [plan([FEATURE.membersManage])] });
    expect(ctx.effective).toEqual(allFeatureKeys(FEATURE_REGISTRY));
  });

  it('rescues a feature a scoped role also grants from the plan filter', () => {
    // The same key held at both levels is pulled OUT of `scoped` and into the
    // app union, so the app grant decides. This is the "overwrite" that makes
    // an org role's key survive a plan that omits it.
    const ctx = compose({
      roles: [superAdmin, role({ level: 'organization', features: [FEATURE.billingManage] })],
      plans: [plan([])],
    });

    expect(ctx.effective).toContain(FEATURE.billingManage);
    expect(ctx.grantedAtAppLevel).toContain(FEATURE.billingManage);
  });

  it('applies at workspace scope with no workspace role and no membership', () => {
    const ctx = composeContext({
      subjectId: 'u1',
      organizationId: 'org1',
      workspaceId: 'ws1',
      roles: [superAdmin],
      plans: [],
    });

    expect(ctx.effective).toContain(FEATURE.workspacesShare);
    // access_all and support_access both set this; either makes every
    // workspace enterable without membership.
    expect(ctx.accessibleWorkspaceIds).toBeNull();
  });

  it('answers an app-level request with the whole registry', () => {
    const ctx = composeContext({ subjectId: 'u1', organizationId: null, roles: [superAdmin] });
    expect(ctx.effective).toEqual(allFeatureKeys(FEATURE_REGISTRY));
  });

  it('lifts the organization cap that would otherwise floor at 1', () => {
    // Role-sourced limits have no "unlimited": absent a row the registry floor
    // of 1 applies, which would cap a super admin at one organization.
    expect(compose({ roles: [superAdmin] }).limits['user:organizations']).toBe(9999);
    expect(compose({ roles: [] }).limits['user:organizations']).toBe(1);
  });
});

describe('composeContext — the seeded client role', () => {
  const client = role({ roleKey: 'client', level: 'app', features: [], limits: { 'user:organizations': 5 } });

  it('grants nothing at app level', () => {
    expect(composeContext({ subjectId: 'u1', organizationId: null, roles: [client] }).effective).toEqual([]);
  });

  it('does not exempt the organization roles they hold from the plan filter', () => {
    // A marker role must not accidentally behave like staff: holding it changes
    // no scoped grant's relationship to the subscription.
    const ctx = compose({
      roles: [client, role({ level: 'organization', features: [FEATURE.billingManage] })],
      plans: [plan([])],
    });

    expect(ctx.granted).toEqual([FEATURE.billingManage]);
    expect(ctx.effective).toEqual([]);
  });

  it('raises the organization cap to 5', () => {
    expect(compose({ roles: [client] }).limits['user:organizations']).toBe(5);
  });
});

/**
 * The badge data. Identity, sitting on a structure that otherwise says only
 * what someone may do — so these tests are mostly about keeping the two apart.
 */
describe('composeContext — appRoles', () => {
  it('reports an app-level role with its label and icon', () => {
    const ctx = compose({
      roles: [role({ level: 'app', features: [], roleKey: 'super-admin', label: 'Super admin', icon: 'crown' })],
    });

    expect(ctx.appRoles).toEqual([{ key: 'super-admin', label: 'Super admin', icon: 'crown' }]);
  });

  it('falls back to the key when a grant carries no label', () => {
    // A caller assembling grants by hand should not have to invent a display
    // name to ask a permission question. The key is always present, and it is
    // what an operator reads in the database anyway.
    const ctx = compose({ roles: [role({ level: 'app', features: [], roleKey: 'support' })] });

    expect(ctx.appRoles).toEqual([{ key: 'support', label: 'support', icon: null }]);
  });

  it('EXCLUDES organization- and workspace-level roles', () => {
    /*
     * The load-bearing one. An organization role is true only inside the
     * organization it belongs to, so drawing it beside a username — which does
     * not change when somebody switches — would produce a badge that is wrong
     * and sited where nobody re-reads it.
     */
    const ctx = compose({
      roles: [
        role({ level: 'organization', features: [], roleKey: 'org-admin', label: 'Org admin', icon: 'shield' }),
        role({ level: 'workspace', features: [], roleKey: 'ws-editor', label: 'Editor', workspaceId: 'ws1' }),
      ],
    });

    expect(ctx.appRoles).toEqual([]);
  });

  it('sorts by key and collapses duplicates, so a badge does not reorder between renders', () => {
    // Row order out of a database is not a promise, and a badge that swaps
    // places between two renders of one session reads as a bug in the session.
    const ctx = compose({
      roles: [
        role({ level: 'app', features: [], roleKey: 'super-admin', label: 'Super admin' }),
        role({ level: 'app', features: [], roleKey: 'client', label: 'Client' }),
        role({ level: 'app', features: [], roleKey: 'client', label: 'Client' }),
      ],
    });

    expect(ctx.appRoles.map((r) => r.key)).toEqual(['client', 'super-admin']);
  });

  it('is empty for someone holding no app-level role', () => {
    const ctx = compose({ roles: [role({ level: 'organization', features: [FEATURE.membersManage] })] });

    expect(ctx.appRoles).toEqual([]);
  });

  it('carries NO authority — a badge is not a grant', () => {
    /*
     * A crown is a label. If anything ever resolved a right from the icon or
     * the label, this is the test that would have caught it: an app role with a
     * grand name and the most privileged-looking icon in the set still grants
     * exactly the features it carries, which here is none.
     */
    const ctx = compose({
      roles: [role({ level: 'app', features: [], roleKey: 'looks-important', label: 'Super admin', icon: 'crown' })],
    });

    expect(ctx.effective).toEqual([]);
    expect(ctx.granted).toEqual([]);
    expect(ctx.grantedAtAppLevel).toEqual([]);
  });
});
