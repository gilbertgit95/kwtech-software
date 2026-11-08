import { buildPlanComparison, type CatalogueLabels, type ComparedPlanInput, notEntitledText } from '../src/index.js';

/**
 * #101: the plans side by side, from the rows the caps and features are
 * enforced from, and what a feature the plan lacks is in.
 */
const plan = (key: string, label: string, over: Partial<ComparedPlanInput> = {}): ComparedPlanInput => ({
  key,
  label,
  isPublic: true,
  archived: false,
  features: [],
  limits: {},
  ...over,
});
const LABELS: CatalogueLabels = {
  features: [
    { key: 'pos:sell', label: 'Point of sale', module: 'pos' },
    { key: 'note:read', label: 'Notes', module: 'note' },
    { key: 'queue:read', label: 'Queuing', module: 'queue' },
  ],
  limits: [
    { key: 'organization:workspaces', label: 'Workspaces', source: 'plan', defaultValue: 1 },
    { key: 'user:organizations', label: 'Organizations per user', source: 'role', defaultValue: 1 },
  ],
};
const PLANS = [
  plan('pro', 'Pro', { features: ['note:read', 'pos:sell'], limits: { 'organization:workspaces': 5 } }),
  plan('free', 'Free', { features: ['note:read'] }),
  plan('starter', 'Basic', { features: ['note:read', 'pos:sell'], limits: { 'organization:workspaces': 1 } }),
  plan('enterprise', 'Custom', { isPublic: false, features: ['note:read', 'pos:sell', 'queue:read'] }),
  plan('old', 'Old', { archived: true, features: ['queue:read'] }),
];
const PRICES = [
  { planKey: 'free', monthly: 0, effectiveFrom: '2026-01-01' },
  { planKey: 'starter', monthly: 50_000, effectiveFrom: '2026-01-01' },
  { planKey: 'pro', monthly: 100_000, effectiveFrom: '2026-01-01' },
  { planKey: 'pro', monthly: 120_000, effectiveFrom: '2026-12-01' },
];
const compare = (currentPlanKey: string | null) =>
  buildPlanComparison({ plans: PLANS, prices: PRICES, today: '2026-11-08', currentPlanKey, labels: LABELS });

describe('buildPlanComparison', () => {
  it('lists the public, unarchived plans cheapest first, at today’s price', () => {
    const comparison = compare('free');
    expect(comparison.plans.map((p) => [p.key, p.monthly, p.current])).toEqual([
      ['free', 0, true],
      ['starter', 50_000, false],
      ['pro', 100_000, false],
    ]);
  });

  it('keeps the organization’s own plan even when nobody else can choose it, marked not offered', () => {
    const custom = compare('enterprise').plans.find((p) => p.key === 'enterprise');
    expect(custom).toMatchObject({ current: true, offered: false, monthly: null });
  });

  it('compares plan caps only, a missing number read as the declared default', () => {
    const comparison = compare('free');
    expect(comparison.limits).toEqual([{ key: 'organization:workspaces', label: 'Workspaces' }]);
    expect(comparison.plans.find((p) => p.key === 'free')?.limits).toEqual({ 'organization:workspaces': 1 });
  });

  it('rows only the features some listed plan includes, in registry order', () => {
    expect(compare('free').features.map((f) => f.key)).toEqual(['pos:sell', 'note:read']);
  });
});

describe('notEntitledText', () => {
  it('names the plans on offer that include it, and the plan the organization is on', () => {
    expect(notEntitledText(compare('free'), 'pos:sell')).toBe('Point of sale is in Basic and Pro. You are on Free.');
  });

  it('never names a plan nobody can choose, and says to contact us when none on offer has it', () => {
    // Custom (not public) and Old (archived) include Queuing; neither is offered.
    expect(notEntitledText(compare('enterprise'), 'queue:read')).toBe(
      'Queuing is not in any plan on offer. Contact us for a Custom plan.',
    );
  });

  it('with no paid plan, says so', () => {
    expect(notEntitledText(compare(null), 'pos:sell')).toBe(
      'Point of sale is in Basic and Pro. Your organization has no paid plan.',
    );
  });
});
