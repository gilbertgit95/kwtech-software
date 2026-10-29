import { PosWriteError } from '../src/server/pos.errors.js';
import type { PosOrderRow } from '../src/server/pos.repository.js';
import { POS_ORDER_TYPES_MAX } from '../src/server/pos-catalogue.service.js';
import { ANA, BEN, harness, OTHER_STORE, SCOPE } from './harness.js';

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PosWriteError) return error.reason;
    throw error;
  }
  return 'no refusal';
}

const ref = (order: Pick<PosOrderRow, 'id' | 'version'>) => ({ orderId: order.id, version: order.version });

/** A restaurant: Dine-in and Takeout, tables as references. */
async function restaurant() {
  const h = harness();
  const dineIn = await h.catalogue.saveOrderType(SCOPE, ANA, { name: 'Dine-in', sortOrder: 0 });
  const takeout = await h.catalogue.saveOrderType(SCOPE, ANA, { name: 'Takeout', sortOrder: 1 });
  return { ...h, dineIn, takeout };
}

describe('order types on the Items tab', () => {
  it('are saved in the store’s order and reach every till with the catalogue', async () => {
    const { catalogue, pubsub } = await restaurant();
    expect((await catalogue.catalogue(SCOPE, false)).orderTypes.map((type) => type.name)).toEqual([
      'Dine-in',
      'Takeout',
    ]);
    expect(pubsub.sent.map((event) => event.change)).toEqual(['catalogue', 'catalogue']);
  });

  it('refuses a second type of the same name, whatever its case', async () => {
    const { catalogue } = await restaurant();
    expect(await refusal(catalogue.saveOrderType(SCOPE, ANA, { name: 'TAKEOUT' }))).toBe('invalid_name');
  });

  it('stops at the cap, archived ones included', async () => {
    const { catalogue } = harness();
    for (let i = 0; i < POS_ORDER_TYPES_MAX; i += 1) await catalogue.saveOrderType(SCOPE, ANA, { name: `Type ${i}` });
    expect(await refusal(catalogue.saveOrderType(SCOPE, ANA, { name: 'One more' }))).toBe('limit_reached');
  });

  it('⚠ keeps at most one default: setting a new one clears the old', async () => {
    const { catalogue, dineIn, takeout } = await restaurant();
    await catalogue.setDefaultOrderType(SCOPE, ANA, dineIn.id);
    await catalogue.setDefaultOrderType(SCOPE, ANA, takeout.id);
    const types = (await catalogue.catalogue(SCOPE, false)).orderTypes;
    expect(types.filter((type) => type.isDefault).map((type) => type.name)).toEqual(['Takeout']);
    expect(await catalogue.setDefaultOrderType(SCOPE, ANA, null)).toBeNull();
    expect((await catalogue.catalogue(SCOPE, false)).orderTypes.some((type) => type.isDefault)).toBe(false);
  });

  it('⚠ clears the default when it is archived, and never makes an archived type the default', async () => {
    const { catalogue, dineIn } = await restaurant();
    await catalogue.setDefaultOrderType(SCOPE, ANA, dineIn.id);
    expect((await catalogue.setOrderTypeArchived(SCOPE, ANA, dineIn.id, true)).isDefault).toBe(false);
    expect(await refusal(catalogue.setDefaultOrderType(SCOPE, ANA, dineIn.id))).toBe('not_found');
    expect((await catalogue.catalogue(SCOPE, false)).orderTypes.map((type) => type.name)).toEqual(['Takeout']);
  });

  it('never touches another store’s types', async () => {
    const { catalogue, dineIn } = await restaurant();
    expect(await refusal(catalogue.setDefaultOrderType(OTHER_STORE, ANA, dineIn.id))).toBe('not_found');
    expect(await refusal(catalogue.setOrderTypeArchived(OTHER_STORE, ANA, dineIn.id, true))).toBe('not_found');
  });
});

describe('an order’s type', () => {
  it('starts on the store’s default type and default reference', async () => {
    const { catalogue, settings, writes, dineIn } = await restaurant();
    await catalogue.setDefaultOrderType(SCOPE, ANA, dineIn.id);
    await settings.saveReferenceOptions(SCOPE, ANA, ['Counter', 'Table 1'], 'Counter');
    const order = await writes.create(SCOPE, BEN, null);
    expect([order.orderTypeId, order.orderTypeName, order.label]).toEqual([dineIn.id, 'Dine-in', 'Counter']);
  });

  it('starts on none without defaults, and a reference given wins over the default', async () => {
    const { settings, writes } = await restaurant();
    expect((await writes.create(SCOPE, BEN, null)).orderTypeName).toBeNull();
    await settings.saveReferenceOptions(SCOPE, ANA, ['Counter', 'Table 1'], 'Counter');
    expect((await writes.create(SCOPE, BEN, 'Table 1')).label).toBe('Table 1');
  });

  it('⚠ copies the type’s NAME: renaming it later never changes the order', async () => {
    const { catalogue, writes, takeout } = await restaurant();
    const order = await writes.create(SCOPE, BEN, null);
    const typed = await writes.setOrderType(SCOPE, BEN, ref(order), takeout.id);
    await catalogue.saveOrderType(SCOPE, ANA, { id: takeout.id, name: 'Take-away', sortOrder: 1 });
    const after = await writes.setLabel(SCOPE, BEN, ref(typed), 'Pickup 3');
    expect([after.orderTypeId, after.orderTypeName]).toEqual([takeout.id, 'Takeout']);
  });

  it('is optional: null clears it', async () => {
    const { writes, takeout } = await restaurant();
    const order = await writes.create(SCOPE, BEN, null);
    const typed = await writes.setOrderType(SCOPE, BEN, ref(order), takeout.id);
    expect((await writes.setOrderType(SCOPE, BEN, ref(typed), null)).orderTypeName).toBeNull();
  });

  it('refuses an archived type, or another store’s', async () => {
    const { catalogue, writes, takeout } = await restaurant();
    await catalogue.setOrderTypeArchived(SCOPE, ANA, takeout.id, true);
    const order = await writes.create(SCOPE, BEN, null);
    expect(await refusal(writes.setOrderType(SCOPE, BEN, ref(order), takeout.id))).toBe('not_found');
    const other = await catalogue.saveOrderType(OTHER_STORE, ANA, { name: 'Delivery' });
    expect(await refusal(writes.setOrderType(SCOPE, BEN, ref(order), other.id))).toBe('not_found');
  });
});

describe('the default reference', () => {
  it('is one of the options, and refused otherwise', async () => {
    const { settings } = harness();
    expect((await settings.saveReferenceOptions(SCOPE, ANA, ['Counter'], 'counter')).defaultReference).toBe('Counter');
    expect(await refusal(settings.saveReferenceOptions(SCOPE, ANA, ['Counter'], 'Pickup'))).toBe(
      'invalid_reference_options',
    );
  });

  it('⚠ goes with its option: a list saved without it has no default', async () => {
    const { settings } = harness();
    await settings.saveReferenceOptions(SCOPE, ANA, ['Counter', 'Table 1'], 'Counter');
    expect((await settings.saveReferenceOptions(SCOPE, ANA, ['Table 1'])).defaultReference).toBeNull();
  });
});
