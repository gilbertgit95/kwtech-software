import {
  capsBlockingDowngrade,
  checkAmount,
  findReferenceReuse,
  isPaymentMethod,
  needsReference,
  normaliseReference,
  pickCoveringPlan,
  planCovers,
} from '../src/index.js';

describe('payment details', () => {
  it('needs a reference for e-wallet and bank transfer, not for cash', () => {
    expect(needsReference('e_wallet')).toBe(true);
    expect(needsReference('bank_transfer')).toBe(true);
    expect(needsReference('cash')).toBe(false);
    expect(isPaymentMethod('card')).toBe(false);
  });

  it('⚠ matches a reference however it was typed', () => {
    expect(normaliseReference(' TRX 55-01 ')).toBe('trx5501');
    const others = [
      { requestId: 'r1', organizationId: 'o1', reference: 'trx55' },
      { requestId: 'r2', organizationId: 'o2', reference: 'TRX-56' },
    ];
    expect(findReferenceReuse('TRX 55', 'r9', others).map((one) => one.requestId)).toEqual(['r1']);
    expect(findReferenceReuse('trx55', 'r1', others)).toEqual([]);
    expect(findReferenceReuse('  ', 'r9', others)).toEqual([]);
  });

  it('says how an amount differs from the bill (D7)', () => {
    expect(checkAmount(100_000, 100_000)).toEqual({ kind: 'exact' });
    expect(checkAmount(90_000, 100_000)).toEqual({ kind: 'short', by: 10_000 });
    expect(checkAmount(120_000, 100_000)).toEqual({ kind: 'over', by: 20_000 });
  });
});

describe('plans compared', () => {
  const free = { key: 'free', features: ['note:read'], limits: { members: 3 } };
  const basic = { key: 'starter', features: ['note:read', 'pos:read'], limits: { members: 10 } };
  const odd = { key: 'odd', features: ['booking:read'], limits: { members: 50 } };

  it('a plan covers another when it has every feature and every cap at least as large', () => {
    expect(planCovers(basic, free)).toBe(true);
    expect(planCovers(free, basic)).toBe(false);
    expect(planCovers({ ...basic, limits: {} }, free)).toBe(false);
  });

  it('⚠ picks the plan covering every other, or none when plans are not nested (D3)', () => {
    expect(pickCoveringPlan([free, basic])?.key).toBe('starter');
    expect(pickCoveringPlan([basic, odd])).toBeNull();
    expect(pickCoveringPlan([])).toBeNull();
  });

  it('names each cap a downgrade is over, with how many to remove (D6)', () => {
    expect(capsBlockingDowngrade({ members: 5, workspaces: 1 }, { limits: { members: 3, workspaces: 1 } })).toEqual([
      { limit: 'members', have: 5, allowed: 3, remove: 2 },
    ]);
    expect(capsBlockingDowngrade({ boards: 2 }, { limits: {} })).toEqual([
      { limit: 'boards', have: 2, allowed: 1, remove: 1 },
    ]);
  });
});
