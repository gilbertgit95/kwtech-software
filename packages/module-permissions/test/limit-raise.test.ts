import { type LimitSpec, limitRaise, type PlanCapOffer } from '../src/index.js';

/**
 * #101: a cap refusal names the plan that set it and the smallest public plan
 * that raises it, worked out once here rather than in each module.
 */
const spec: LimitSpec = {
  key: 'organization:workspaces',
  label: 'Branches',
  description: 'Workspaces per organization',
  source: 'plan',
  countedOver: 'organization',
  required: true,
  defaultValue: 1,
};
const offer = (
  key: string,
  label: string,
  cap: number | undefined,
  over: Partial<PlanCapOffer> = {},
): PlanCapOffer => ({
  key,
  label,
  isPublic: true,
  archived: false,
  limits: cap === undefined ? {} : { [spec.key]: cap },
  ...over,
});
const CATALOGUE = [
  offer('free', 'Free', 1),
  offer('starter', 'Basic', 1),
  offer('pro', 'Pro', 5),
  offer('enterprise', 'Custom', 50, { isPublic: false }),
];

describe('limitRaise', () => {
  it('names the plan whose number is the cap, and the smallest public plan above it', () => {
    expect(limitRaise({ spec, cap: 1, planKeys: ['starter'], catalogue: CATALOGUE })).toEqual({
      plan: { key: 'starter', label: 'Basic' },
      next: { key: 'pro', label: 'Pro', limit: 5 },
    });
  });

  it('never offers a plan that does not raise the cap, one held, or one nobody can choose', () => {
    // Free also allows 1, Custom is not public: on Pro nothing is next.
    expect(limitRaise({ spec, cap: 5, planKeys: ['pro'], catalogue: CATALOGUE })?.next).toBeNull();
    const archived = [...CATALOGUE.slice(0, 2), offer('pro', 'Pro', 5, { archived: true })];
    expect(limitRaise({ spec, cap: 1, planKeys: ['starter'], catalogue: archived })?.next).toBeNull();
  });

  it('picks the smallest raise, and "no limit" only after every number', () => {
    const catalogue = [
      offer('starter', 'Basic', 1),
      offer('max', 'Max', undefined, { limits: {} }),
      offer('pro', 'Pro', 5),
      offer('team', 'Team', 3),
    ];
    // Max sets nothing: the declared default (1) applies, so it does not raise.
    expect(limitRaise({ spec, cap: 1, planKeys: ['starter'], catalogue })?.next).toEqual({
      key: 'team',
      label: 'Team',
      limit: 3,
    });
    const unlimited = { ...spec, defaultValue: null };
    expect(limitRaise({ spec: unlimited, cap: 5, planKeys: ['pro'], catalogue })?.next).toEqual({
      key: 'max',
      label: 'Max',
      limit: null,
    });
  });

  it('with no plan held, names none but still offers the raise', () => {
    expect(limitRaise({ spec, cap: 1, planKeys: [], catalogue: CATALOGUE })).toEqual({
      plan: null,
      next: { key: 'pro', label: 'Pro', limit: 5 },
    });
  });

  it('says nothing for a role-sourced cap: no plan sells it', () => {
    expect(
      limitRaise({ spec: { ...spec, source: 'role' }, cap: 1, planKeys: ['starter'], catalogue: CATALOGUE }),
    ).toBeUndefined();
  });
});
