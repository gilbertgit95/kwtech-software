import { LIMIT, LIMIT_REGISTRY } from '../src/domain/limits.js';
import {
  clonePlanFeatures,
  DEFAULT_PLAN_LIMIT,
  defaultPlanLimitFields,
  EMPTY_PLAN_DRAFT,
  type PlanDraft,
  planLimitFields,
  planLimitValues,
  validatePlanDraft,
} from '../src/domain/plan-draft.js';
import { assertPlanFeatureLevels, canPlanEntitle, featuresForPlan } from '../src/domain/plans.js';
import type { FeatureSpec } from '../src/types.js';

const REGISTRY: FeatureSpec[] = [
  { key: 'reports:read', module: 'demo', level: 'organization', label: 'Read reports', description: '' },
  { key: 'reports:share', module: 'demo', level: 'workspace', label: 'Share reports', description: '' },
  { key: 'platform:support_access', module: 'demo', level: 'app', label: 'Support', description: '' },
];

/** Every required plan-sourced cap, filled in — the baseline a valid draft needs. */
const LIMITS = {
  [LIMIT.organizationMembers]: '10',
  [LIMIT.organizationWorkspaces]: '3',
  [LIMIT.workspaceMembers]: '5',
};

function draft(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return { ...EMPTY_PLAN_DRAFT, key: 'team', label: 'Team', limits: LIMITS, ...overrides };
}

describe('what a plan may sell', () => {
  it('accepts organization and workspace features', () => {
    expect(canPlanEntitle('organization')).toBe(true);
    expect(canPlanEntitle('workspace')).toBe(true);
  });

  /**
   * The rule the whole plan model rests on: app-level grants are unioned in
   * AFTER the entitlement filter, so an app key inside a plan is never
   * consulted. It would read as a sold feature and entitle nobody.
   */
  it('refuses app-level features, which entitlement never consults', () => {
    expect(canPlanEntitle('app')).toBe(false);
    expect(featuresForPlan(REGISTRY).map((spec) => spec.key)).toEqual(['reports:read', 'reports:share']);
  });

  it('fails loudly rather than filtering, when a definition carries one', () => {
    expect(() =>
      assertPlanFeatureLevels(
        { key: 'team', label: 'Team', isPublic: true, features: ['platform:support_access'], limits: {} },
        REGISTRY,
      ),
    ).toThrow(/app-level features are exempt from entitlement/);
  });

  it('refuses an unregistered key, which can never be checked', () => {
    expect(() =>
      assertPlanFeatureLevels(
        { key: 'team', label: 'Team', isPublic: true, features: ['nope:at-all'], limits: {} },
        REGISTRY,
      ),
    ).toThrow(/not in the registry/);
  });
});

describe('validatePlanDraft', () => {
  it('accepts a well-formed draft', () => {
    expect(validatePlanDraft(draft({ features: ['reports:read'] }), { registry: REGISTRY })).toEqual({});
  });

  it('reports every problem at once, not the first', () => {
    const errors = validatePlanDraft(
      draft({ key: 'Team Annual', label: '  ', features: ['platform:support_access'] }),
      { registry: REGISTRY },
    );
    expect(Object.keys(errors).sort()).toEqual(['features', 'key', 'label']);
  });

  it('refuses a duplicate key, but not the key being edited', () => {
    const options = { registry: REGISTRY, existingKeys: ['team', 'free'] };
    expect(validatePlanDraft(draft(), options).key).toMatch(/already used/);
    expect(validatePlanDraft(draft(), { ...options, originalKey: 'team' }).key).toBeUndefined();
  });

  /**
   * A plan that omits a required cap falls back to the registry floor of ONE
   * and silently caps a paying customer at a single seat — the expensive
   * direction to be wrong in, and why this is an error rather than a default.
   */
  it('requires every required plan-sourced cap', () => {
    const errors = validatePlanDraft(draft({ limits: { [LIMIT.organizationMembers]: '10' } }), {
      registry: REGISTRY,
    });
    expect(errors.limits).toMatch(/required and unset/);
    expect(errors.limits).toContain(LIMIT.organizationWorkspaces);
    expect(errors.limits).toContain(LIMIT.workspaceMembers);
  });

  it('refuses a cap that is not a whole number of one or more', () => {
    for (const value of ['0', '-3', '2.5', 'abc']) {
      const errors = validatePlanDraft(draft({ limits: { ...LIMITS, [LIMIT.organizationMembers]: value } }), {
        registry: REGISTRY,
      });
      expect(errors.limits).toMatch(/whole number of 1 or more/);
    }
  });

  /**
   * `user:organizations` is ROLE-sourced — it comes from an app-level role and
   * is asked before any organization exists. A plan neither needs it nor may
   * set it, so its absence must not be reported as a missing cap.
   */
  it('ignores role-sourced caps entirely', () => {
    expect(validatePlanDraft(draft(), { registry: REGISTRY }).limits).toBeUndefined();
  });
});

describe('plan limit fields', () => {
  it('round-trips numbers through the strings a form edits', () => {
    expect(planLimitValues(planLimitFields({ [LIMIT.organizationMembers]: 10 }))).toEqual({
      [LIMIT.organizationMembers]: 10,
    });
  });

  it('drops blanks rather than writing zero — blank means "this plan does not set it"', () => {
    expect(planLimitValues({ ...LIMITS, [LIMIT.workspaceMembers]: '   ' })).toEqual({
      [LIMIT.organizationMembers]: 10,
      [LIMIT.organizationWorkspaces]: 3,
    });
  });
});

describe('clonePlanFeatures', () => {
  it('replaces or adds, and reports what it dropped', () => {
    const replaced = clonePlanFeatures(['reports:share'], ['reports:read', 'platform:support_access'], 'replace', {
      registry: REGISTRY,
    });
    expect(replaced.features).toEqual(['reports:read']);
    expect(replaced.skipped).toEqual([{ key: 'platform:support_access', reason: 'wrong_level' }]);

    const added = clonePlanFeatures(['reports:share'], ['reports:read'], 'add', { registry: REGISTRY });
    expect(added.features).toEqual(['reports:read', 'reports:share']);
    expect(added.added).toEqual(['reports:read']);
  });

  /**
   * The asymmetry with roles, asserted rather than only documented: a role
   * clone filters by what the actor holds, because putting a right into a role
   * you do not have is escalation. A plan entitles rather than grants, so there
   * is nothing to escalate through — the whole catalogue is copyable.
   */
  it('never filters by what the actor holds', () => {
    const result = clonePlanFeatures([], ['reports:read', 'reports:share'], 'replace', { registry: REGISTRY });
    expect(result.skipped).toEqual([]);
    expect(result.features).toEqual(['reports:read', 'reports:share']);
  });
});

describe('the caps a new plan starts with', () => {
  /**
   * Every plan-sourced cap is REQUIRED, so a blank form is one that cannot be
   * saved until three numbers are typed. Prefilling them is what makes the
   * create screen submittable on sight.
   */
  it('prefills every required plan-sourced cap, and validates as-is', () => {
    expect(defaultPlanLimitFields()).toEqual({
      [LIMIT.organizationMembers]: '5',
      [LIMIT.organizationWorkspaces]: '5',
      [LIMIT.workspaceMembers]: '5',
    });

    const fresh: PlanDraft = { ...EMPTY_PLAN_DRAFT, key: 'team', label: 'Team' };
    expect(validatePlanDraft(fresh, { registry: REGISTRY })).toEqual({});
    expect(planLimitValues(fresh.limits)[LIMIT.organizationMembers]).toBe(DEFAULT_PLAN_LIMIT);
  });

  /**
   * ROLE-sourced caps are never prefilled: `user:organizations` comes from an
   * app-level role and has no meaning inside a plan at all.
   */
  it('never prefills a role-sourced cap', () => {
    expect(defaultPlanLimitFields()[LIMIT.userOrganizations]).toBeUndefined();
  });

  /**
   * An OPTIONAL cap stays blank, and the distinction is not cosmetic: blank
   * means "this plan does not set it" and resolves to the registry floor, so
   * prefilling would silently cap something the author never chose.
   */
  it('leaves an optional plan cap blank rather than guessing one', () => {
    const registry = [
      ...LIMIT_REGISTRY,
      {
        key: 'organization:seats-extra',
        label: 'Extra seats',
        description: '',
        source: 'plan' as const,
        countedOver: 'organization' as const,
        required: false,
        defaultValue: 1,
      },
    ];

    expect(defaultPlanLimitFields(registry)['organization:seats-extra']).toBeUndefined();
  });
});
