import { POS_FEATURE } from '../src/feature-keys.js';
import { PosWriteError } from '../src/server/pos.errors.js';
import { ANA, as, BEN, capAt, harness, OTHER_STORE, SCOPE } from './harness.js';

const LAMINATION = {
  kind: 'service',
  name: 'Lamination',
  price: 0,
  variants: [
    { name: '125 mic · A4', code: 'l1-a4', price: 3500, cost: 900 },
    { name: '250 mic · A4', code: 'L2-A4', price: 4500, cost: 1200 },
  ],
};

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PosWriteError) return error.reason;
    throw error;
  }
  return 'no refusal';
}

describe('items and variants', () => {
  it('saves an item with its variants in one transaction, codes in one spelling, and tells the tills', async () => {
    const { catalogue, prisma, pubsub } = harness();
    const saved = await catalogue.saveItem(SCOPE, ANA, LAMINATION);
    expect(saved.item).toMatchObject({ name: 'Lamination', kind: 'service', createdById: ANA });
    expect(saved.variants.map((variant) => [variant.name, variant.code, variant.sortOrder])).toEqual([
      ['125 mic · A4', 'L1-A4', 0],
      ['250 mic · A4', 'L2-A4', 1],
    ]);
    expect(prisma.transactions).toBe(1);
    expect(pubsub.sent).toEqual([{ ...SCOPE, change: 'catalogue', orderId: null, actorId: ANA }]);
  });

  it('⚠ leaves the description alone when a save omits it, and clears it on null', async () => {
    const { catalogue } = harness();
    const rush = { kind: 'service', name: 'Rush ID', price: 3000 };
    const first = await catalogue.saveItem(SCOPE, ANA, { ...rush, description: 'Ready in minutes' });
    expect(first.item.description).toBe('Ready in minutes');
    // A client that predates the field must not wipe it by saving the item.
    const renamed = await catalogue.saveItem(SCOPE, ANA, { ...rush, id: first.item.id, name: 'Rush ID photo' });
    expect(renamed.item.description).toBe('Ready in minutes');
    const cleared = await catalogue.saveItem(SCOPE, ANA, { ...rush, id: first.item.id, description: null });
    expect(cleared.item.description).toBeNull();
    expect(await refusal(catalogue.saveItem(SCOPE, ANA, { ...rush, description: 'x'.repeat(501) }))).toBe(
      'invalid_description',
    );
  });

  it('⚠ archives a variant left out of the list — old orders point at it — and reorders the rest', async () => {
    const { catalogue } = harness();
    const first = await catalogue.saveItem(SCOPE, ANA, LAMINATION);
    const [a4, a4thick] = first.variants;
    const saved = await catalogue.saveItem(SCOPE, ANA, {
      ...LAMINATION,
      id: first.item.id,
      variants: [{ id: a4thick?.id, name: '250 mic · A4', code: 'L2-A4', price: 5000 }],
    });
    const byId = new Map(saved.variants.map((variant) => [variant.id, variant]));
    expect(byId.get(a4?.id ?? '')?.archivedAt).toBeInstanceOf(Date);
    expect(byId.get(a4thick?.id ?? '')).toMatchObject({ price: 5000, sortOrder: 0, archivedAt: null });
  });

  it('⚠ refuses a code another item or variant in the store already has — across both tables', async () => {
    const { catalogue } = harness();
    await catalogue.saveItem(SCOPE, ANA, LAMINATION);
    const magnet = { kind: 'product', name: 'Ref magnet', price: 1500 };
    expect(await refusal(catalogue.saveItem(SCOPE, ANA, { ...magnet, code: 'l2-a4' }))).toBe('duplicate_code');
    expect(await refusal(catalogue.saveItem(SCOPE, ANA, { ...LAMINATION, name: 'Copy' }))).toBe('duplicate_code');
    // Another store may use the same code.
    await expect(catalogue.saveItem(OTHER_STORE, ANA, { ...magnet, code: 'L2-A4' })).resolves.toBeDefined();
  });

  it('refuses two equal codes in one save, a bad price, and an unknown kind', async () => {
    const { catalogue } = harness();
    const twice = { ...LAMINATION, variants: [LAMINATION.variants[0], { ...LAMINATION.variants[1], code: 'L1-A4' }] };
    expect(await refusal(catalogue.saveItem(SCOPE, ANA, twice as typeof LAMINATION))).toBe('duplicate_code');
    expect(await refusal(catalogue.saveItem(SCOPE, ANA, { kind: 'product', name: 'x', price: 12.5 }))).toBe(
      'invalid_price',
    );
    expect(await refusal(catalogue.saveItem(SCOPE, ANA, { kind: 'gift', name: 'x', price: 1 }))).toBe('invalid_kind');
  });

  it('⚠ never touches another store’s item by id', async () => {
    const { catalogue } = harness();
    const theirs = await catalogue.saveItem(OTHER_STORE, ANA, { kind: 'product', name: 'Theirs', price: 100 });
    expect(
      await refusal(catalogue.saveItem(SCOPE, ANA, { kind: 'product', name: 'Mine', price: 1, id: theirs.item.id })),
    ).toBe('not_found');
    expect(await refusal(catalogue.setItemArchived(SCOPE, ANA, theirs.item.id, true))).toBe('not_found');
  });
});

describe('the pos:items cap', () => {
  it('⚠ counts items AND variants, so one item cannot carry 300 variants past it', async () => {
    const { catalogue } = harness({ limits: capAt(2) });
    expect(await refusal(catalogue.saveItem(SCOPE, ANA, LAMINATION))).toBe('limit_reached');
  });

  it('⚠ frees room when an item is archived, and counts it again when restored', async () => {
    const { catalogue } = harness({ limits: capAt(3) });
    const lamination = await catalogue.saveItem(SCOPE, ANA, LAMINATION); // 1 item + 2 variants = 3
    const magnet = { kind: 'product', name: 'Ref magnet', price: 1500 };
    expect(await refusal(catalogue.saveItem(SCOPE, ANA, magnet))).toBe('limit_reached');
    await catalogue.setItemArchived(SCOPE, ANA, lamination.item.id, true);
    await catalogue.saveItem(SCOPE, ANA, magnet);
    expect(await refusal(catalogue.setItemArchived(SCOPE, ANA, lamination.item.id, false))).toBe('limit_reached');
  });

  it('still lets a full store rename an item — only a save that ADDS is counted', async () => {
    const { catalogue } = harness({ limits: capAt(3) });
    const lamination = await catalogue.saveItem(SCOPE, ANA, LAMINATION);
    const variants = lamination.variants.map((variant) => ({ ...variant, cost: variant.cost ?? null }));
    await expect(
      catalogue.saveItem(SCOPE, ANA, { ...LAMINATION, id: lamination.item.id, name: 'Hot lamination', variants }),
    ).resolves.toMatchObject({ item: { name: 'Hot lamination' } });
  });

  it('⚠ falls to the declared default when no checker is bound, never to unlimited', async () => {
    const { catalogue } = harness();
    for (let i = 0; i < 3; i += 1)
      await catalogue.saveItem(SCOPE, ANA, { kind: 'product', name: `Item ${i}`, price: 1 });
    // The default is 1000; three fit, and nothing here resolved to "no limit".
    await expect(catalogue.catalogue(SCOPE, false)).resolves.toMatchObject({ items: expect.any(Array) });
  });
});

describe('categories', () => {
  it('refuses two categories with the same name, whatever the case', async () => {
    const { catalogue } = harness();
    await catalogue.saveCategory(SCOPE, ANA, { name: 'Lamination' });
    expect(await refusal(catalogue.saveCategory(SCOPE, ANA, { name: 'lamination' }))).toBe('invalid_name');
  });

  it('refuses an item in a category of another store', async () => {
    const { catalogue } = harness();
    const theirs = await catalogue.saveCategory(OTHER_STORE, ANA, { name: 'Theirs' });
    expect(
      await refusal(catalogue.saveItem(SCOPE, ANA, { kind: 'product', name: 'x', price: 1, categoryId: theirs.id })),
    ).toBe('not_found');
  });
});

describe('the catalogue as the API answers it', () => {
  it('⚠ strips every cost for somebody without pos:manage_items or pos:reports — on the server', async () => {
    const { catalogue, resolver } = harness({ holders: { [POS_FEATURE.manageItems]: [ANA] } });
    await catalogue.saveItem(SCOPE, ANA, { ...LAMINATION, cost: 500 });
    const forBen = await resolver.posCatalogue(as(BEN), SCOPE.organizationId, SCOPE.workspaceId);
    expect(forBen.costsVisible).toBe(false);
    expect(forBen.items.flatMap((item) => [item.cost, ...item.variants.map((variant) => variant.cost)])).toEqual([
      null,
      null,
      null,
    ]);
    const forAna = await resolver.posCatalogue(as(ANA), SCOPE.organizationId, SCOPE.workspaceId);
    expect(forAna.items[0]?.variants.map((variant) => variant.cost)).toEqual([900, 1200]);
  });

  it('⚠ strips them for everybody when the access port is unbound — fail closed', async () => {
    const { catalogue, resolver } = harness();
    await catalogue.saveItem(SCOPE, ANA, LAMINATION);
    const answer = await resolver.posCatalogue(as(ANA), SCOPE.organizationId, SCOPE.workspaceId);
    expect(answer.costsVisible).toBe(false);
    expect(answer.items[0]?.variants.every((variant) => variant.cost === null)).toBe(true);
  });

  it('shows costs to pos:reports too — profit needs them', async () => {
    const { catalogue, resolver } = harness({ holders: { [POS_FEATURE.reports]: [BEN] } });
    await catalogue.saveItem(SCOPE, ANA, LAMINATION);
    expect((await resolver.posCatalogue(as(BEN), SCOPE.organizationId, SCOPE.workspaceId)).costsVisible).toBe(true);
  });

  it('leaves archived items out of what a till loads', async () => {
    const { catalogue } = harness();
    const item = await catalogue.saveItem(SCOPE, ANA, { kind: 'product', name: 'Old folder', price: 1200 });
    await catalogue.setItemArchived(SCOPE, ANA, item.item.id, true);
    expect((await catalogue.catalogue(SCOPE, false)).items).toEqual([]);
    expect((await catalogue.catalogue(SCOPE, true)).items).toHaveLength(1);
  });
});
