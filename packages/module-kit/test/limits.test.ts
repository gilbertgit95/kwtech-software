import { composeLimits, type LimitContribution, NULL_LIMIT_CHECKER } from '../src/index.js';

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
