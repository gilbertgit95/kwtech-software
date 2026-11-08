import { composeLimits, type LimitContribution, limitReachedText, NULL_LIMIT_CHECKER } from '../src/index.js';

const limit = (key: string, module: string): LimitContribution => ({
  key,
  module,
  label: key,
  description: key,
  source: 'role',
  countedOver: 'user',
  defaultValue: 1,
});

describe('composeLimits', () => {
  it('flattens every module contribution', () => {
    const composed = composeLimits([
      { key: 'chat', limits: [limit('chat:group_chats', 'chat')] },
      { key: 'permissions', limits: [limit('user:organizations', 'permissions')] },
    ]);

    expect(composed.map((entry) => entry.key)).toEqual(['chat:group_chats', 'user:organizations']);
  });

  it('ignores a module that declares none', () => {
    expect(composeLimits([{ key: 'auth' }])).toEqual([]);
  });

  it('refuses one key claimed by two modules, naming both', () => {
    // The seeder is what would otherwise resolve this silently, by writing
    // whichever row happened to come last.
    expect(() =>
      composeLimits([
        { key: 'chat', limits: [limit('shared:cap', 'chat')] },
        { key: 'records', limits: [limit('shared:cap', 'records')] },
      ]),
    ).toThrow(/declared by both 'chat' and 'records'/);
  });
});

describe('NULL_LIMIT_CHECKER', () => {
  it('allows, unrestricted, so a module runs in an app with no permission model', async () => {
    await expect(NULL_LIMIT_CHECKER.check({ actorId: 'u1', key: 'chat:group_chats', current: 9999 })).resolves.toEqual({
      allowed: true,
      limit: null,
      current: 9999,
      remaining: null,
    });
  });
});

describe('limitReachedText (#101)', () => {
  const branch = { one: 'branch', many: 'branches' };
  const basic = { key: 'starter', label: 'Basic' };

  it('names the plan and the next one that raises the cap', () => {
    expect(
      limitReachedText({ limit: 1, raise: { plan: basic, next: { key: 'pro', label: 'Pro', limit: 5 } } }, branch),
    ).toBe('Basic allows 1 branch. Pro allows 5.');
  });

  it('formats large numbers', () => {
    const items = { one: 'item for sale', many: 'items for sale' };
    expect(
      limitReachedText({ limit: 500, raise: { plan: basic, next: { key: 'pro', label: 'Pro', limit: 5000 } } }, items),
    ).toBe('Basic allows 500 items for sale. Pro allows 5,000.');
  });

  it('says when the next plan has no limit', () => {
    expect(
      limitReachedText({ limit: 1, raise: { plan: basic, next: { key: 'pro', label: 'Pro', limit: null } } }, branch),
    ).toBe('Basic allows 1 branch. Pro has no limit.');
  });

  it('on the highest public plan, points to a Custom plan', () => {
    expect(limitReachedText({ limit: 5, raise: { plan: { key: 'pro', label: 'Pro' }, next: null } }, branch)).toBe(
      'Pro allows 5 branches. This is the most any plan allows. Contact us for a Custom plan.',
    );
  });

  it('with no plan behind the cap, says only the number', () => {
    expect(limitReachedText({ limit: 3 }, { one: 'board', many: 'boards' })).toBe('You can have 3 boards here.');
  });
});
