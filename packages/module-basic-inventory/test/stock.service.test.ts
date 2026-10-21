import type { ProcessRunContext } from '@kwtech/module-kit';
import type { StockSourceEvent } from '../src/server/ports.js';
import { StockWriteError } from '../src/server/stock.errors.js';
import { ANA, fixedFeed, harness, OTHER, press, SCOPE } from './harness.js';

/** The reason a call was refused, or 'ok'. */
async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof StockWriteError) return error.reason;
    throw error;
  }
}

/** A Sintraboard Photo Print set up as the operator described it, with stock on the shelf. */
async function sintraboardStore() {
  const h = harness();
  const item = (name: string, unit: 'piece' | 'sheet' | 'm', kind: 'material' | 'for_sale' = 'material') =>
    h.catalogue.saveItem(SCOPE, ANA, { kind, name, unit });
  const hook = await item('Hook', 'piece');
  const border = await item('Border protector', 'm');
  const boardA3 = await item('Sintraboard A3', 'piece');
  const vinyl = await item('Vinyl', 'sheet');
  const mug = await item('Mug 11 oz', 'piece', 'for_sale');
  await h.catalogue.setUses(SCOPE, ANA, { refKind: 'item', refId: 'sintra', refItemId: 'sintra' }, [
    { stockItemId: hook.id, quantityPerUnit: 1000 },
    { stockItemId: border.id, quantityPerUnit: 1200 },
  ]);
  await h.catalogue.setUses(SCOPE, ANA, { refKind: 'variant', refId: 'sintra-a3', refItemId: 'sintra' }, [
    { stockItemId: boardA3.id, quantityPerUnit: 1000 },
    { stockItemId: vinyl.id, quantityPerUnit: 2000 },
  ]);
  await h.catalogue.setUses(SCOPE, ANA, { refKind: 'item', refId: 'mug', refItemId: 'mug' }, [
    { stockItemId: mug.id, quantityPerUnit: 1000 },
  ]);
  for (const [id, quantity] of [
    [hook.id, 10_000],
    [border.id, 50_000],
    [boardA3.id, 5000],
    [vinyl.id, 100_000],
    [mug.id, 6000],
  ] as const) {
    await h.moves.receive(SCOPE, ANA, { stockItemId: id, quantity, clientId: press() });
  }
  return { ...h, hook, border, boardA3, vinyl, mug };
}

async function onHand(h: ReturnType<typeof harness>, id: string): Promise<number> {
  return (await h.catalogue.item(SCOPE, id)).onHand;
}

const SOLD_A3: StockSourceEvent = {
  kind: 'finalised',
  lineId: 'line-1',
  itemId: 'sintra',
  variantId: 'sintra-a3',
  quantity: 2,
  at: '2026-10-21T02:00:00.000Z',
};

describe('a sale reported by the point of sale', () => {
  it('⚠ takes the item’s and the variant’s materials, once', async () => {
    const h = await sintraboardStore();
    await h.intake.apply(SCOPE, [SOLD_A3]);
    await h.intake.apply(SCOPE, [SOLD_A3]);
    expect(await onHand(h, h.hook.id)).toBe(8000);
    expect(await onHand(h, h.border.id)).toBe(47_600);
    expect(await onHand(h, h.boardA3.id)).toBe(3000);
    expect(await onHand(h, h.vinyl.id)).toBe(96_000);
    expect(await onHand(h, h.mug.id)).toBe(6000);
  });

  it('⚠ never takes more because a list was edited before the event came again', async () => {
    const h = await sintraboardStore();
    await h.intake.apply(SCOPE, [SOLD_A3]);
    await h.catalogue.setUses(SCOPE, ANA, { refKind: 'item', refId: 'sintra', refItemId: 'sintra' }, [
      { stockItemId: h.hook.id, quantityPerUnit: 2000 },
    ]);
    const replay = await h.intake.apply(SCOPE, [SOLD_A3]);
    expect(replay).toEqual({ recorded: 0, skipped: 1 });
    expect(await onHand(h, h.hook.id)).toBe(8000);
  });

  it('never refuses a sale past zero — the count goes negative and says so', async () => {
    const h = await sintraboardStore();
    await h.intake.apply(SCOPE, [{ ...SOLD_A3, quantity: 4 }]);
    const board = await h.catalogue.item(SCOPE, h.boardA3.id);
    expect(board.onHand).toBe(1000);
    await h.intake.apply(SCOPE, [{ ...SOLD_A3, lineId: 'line-2', quantity: 3 }]);
    const after = await h.catalogue.item(SCOPE, h.boardA3.id);
    expect([after.onHand, after.level]).toEqual([-2000, 'negative']);
  });

  it('a void puts back everything; a refund put back returns only for-sale stock', async () => {
    const h = await sintraboardStore();
    await h.intake.apply(SCOPE, [SOLD_A3]);
    await h.intake.apply(SCOPE, [{ kind: 'voided', lineId: 'line-1', at: SOLD_A3.at }]);
    expect(await onHand(h, h.boardA3.id)).toBe(5000);

    const mugSale: StockSourceEvent = {
      kind: 'finalised',
      lineId: 'line-m',
      itemId: 'mug',
      variantId: null,
      quantity: 2,
      at: SOLD_A3.at,
    };
    await h.intake.apply(SCOPE, [mugSale]);
    const refund: StockSourceEvent = {
      kind: 'returned',
      refundLineId: 'refund-1',
      lineId: 'line-m',
      lineQuantity: 2,
      quantity: 1,
      at: SOLD_A3.at,
    };
    await h.intake.apply(SCOPE, [refund, refund]);
    expect(await onHand(h, h.mug.id)).toBe(5000);

    await h.intake.apply(SCOPE, [{ ...SOLD_A3, lineId: 'line-9' }]);
    await h.intake.apply(SCOPE, [{ ...refund, refundLineId: 'refund-9', lineId: 'line-9' }]);
    expect(await onHand(h, h.boardA3.id)).toBe(3000);
  });

  it('moves nothing for a product nothing uses, and tells the till only when stock moved', async () => {
    const h = await sintraboardStore();
    const before = h.told.length;
    const result = await h.intake.apply(SCOPE, [
      { kind: 'finalised', lineId: 'line-x', itemId: 'layout', variantId: null, quantity: 1, at: SOLD_A3.at },
    ]);
    expect(result).toEqual({ recorded: 0, skipped: 1 });
    expect(h.told.length).toBe(before);
    await h.intake.apply(SCOPE, [SOLD_A3]);
    expect(h.told.length).toBe(before + 1);
  });

  it('answers the till how many it can still make, and null for an untracked product', async () => {
    const h = await sintraboardStore();
    expect(
      await h.intake.levelsFor(SCOPE, [
        { itemId: 'sintra', variantId: 'sintra-a3' },
        { itemId: 'layout', variantId: null },
      ]),
    ).toEqual([
      { itemId: 'sintra', variantId: 'sintra-a3', left: 5 },
      { itemId: 'layout', variantId: null, left: null },
    ]);
  });
});

describe('the catch-up process', () => {
  function context(now: string): ProcessRunContext {
    return {
      now: new Date(now),
      schedule: { kind: 'interval', everyMinutes: 15 },
      maxItems: 100,
      tooLateAfterMinutes: 10_080,
      signal: new AbortController().signal,
      workspaces: async () => ({
        workspaces: [{ ...SCOPE, timeZone: 'Asia/Manila' }],
        nextCursor: null,
      }),
    };
  }

  it('⚠ replays a lost sale, and a run after it takes nothing more', async () => {
    const feed = fixedFeed([{ ...SOLD_A3, at: new Date(Date.now() + 1000).toISOString() }]);
    const h = harness({ feed });
    const board = await h.catalogue.saveItem(SCOPE, ANA, { kind: 'material', name: 'Board', unit: 'piece' });
    await h.catalogue.setUses(SCOPE, ANA, { refKind: 'variant', refId: 'sintra-a3', refItemId: 'sintra' }, [
      { stockItemId: board.id, quantityPerUnit: 1000 },
    ]);
    const later = new Date(Date.now() + 60_000).toISOString();
    const first = await h.catchUp.run(context(later));
    const second = await h.catchUp.run(context(later));
    expect(first.handled).toBe(1);
    expect(second.handled).toBe(1);
    expect((await h.catalogue.item(SCOPE, board.id)).onHand).toBe(-2000);
  });

  it('does nothing in a workspace that never hung a list on a product, or with no feed', async () => {
    const feed = fixedFeed([SOLD_A3]);
    expect((await harness({ feed }).catchUp.run(context('2026-10-21T03:00:00Z'))).handled).toBe(0);
    expect((await harness().catchUp.run(context('2026-10-21T03:00:00Z'))).handled).toBe(0);
    expect(feed.asked).toEqual([]);
  });
});

describe('moves made by hand', () => {
  it('⚠ a double press records one delivery, and the latest cost becomes the item’s', async () => {
    const h = harness();
    const paper = await h.catalogue.saveItem(SCOPE, ANA, {
      kind: 'material',
      name: '4R paper',
      unit: 'sheet',
      unitCost: 400,
    });
    const clientId = press();
    const first = await h.moves.receive(SCOPE, ANA, {
      stockItemId: paper.id,
      quantity: 500_000,
      unitCost: 420,
      clientId,
    });
    const again = await h.moves.receive(SCOPE, ANA, {
      stockItemId: paper.id,
      quantity: 500_000,
      unitCost: 420,
      clientId,
    });
    expect(again.id).toBe(first.id);
    const item = await h.catalogue.item(SCOPE, paper.id);
    expect([item.onHand, item.unitCost, item.value]).toEqual([500_000, 420, 210_000]);
    expect(first.createdByName).toBe('Ana');
  });

  it('refuses half a sheet, an archived item, and another store’s item', async () => {
    const h = harness();
    const paper = await h.catalogue.saveItem(SCOPE, ANA, { kind: 'material', name: 'Paper', unit: 'sheet' });
    expect(await reason(h.moves.receive(SCOPE, ANA, { stockItemId: paper.id, quantity: 500, clientId: press() }))).toBe(
      'whole_units_only',
    );
    expect(
      await reason(h.moves.receive(OTHER, ANA, { stockItemId: paper.id, quantity: 1000, clientId: press() })),
    ).toBe('not_found');
    await h.catalogue.setItemArchived(SCOPE, ANA, paper.id, true);
    expect(
      await reason(h.moves.receive(SCOPE, ANA, { stockItemId: paper.id, quantity: 1000, clientId: press() })),
    ).toBe('archived');
  });

  it('an adjustment needs a known reason, and a note for “other”', async () => {
    const h = harness();
    const hook = await h.catalogue.saveItem(SCOPE, ANA, { kind: 'material', name: 'Hook', unit: 'piece' });
    expect(
      await reason(
        h.moves.adjust(SCOPE, ANA, { stockItemId: hook.id, quantity: -1000, reason: 'stolen', clientId: press() }),
      ),
    ).toBe('invalid_kind');
    expect(
      await reason(
        h.moves.adjust(SCOPE, ANA, { stockItemId: hook.id, quantity: -1000, reason: 'other', clientId: press() }),
      ),
    ).toBe('note_required');
    await h.moves.adjust(SCOPE, ANA, { stockItemId: hook.id, quantity: 3000, reason: 'found', clientId: press() });
    expect(await onHand(h, hook.id)).toBe(3000);
  });

  it('⚠ a waste of a product writes one wasted move per material, carrying the product and the reason (I15)', async () => {
    const h = await sintraboardStore();
    const moves = await h.moves.waste(SCOPE, ANA, {
      lines: [
        { stockItemId: h.boardA3.id, quantity: 1000 },
        { stockItemId: h.vinyl.id, quantity: 2000 },
      ],
      reason: 'misprint',
      of: { refId: 'sintra-a3', refLabel: 'Sintraboard Photo Print — A3' },
      clientId: press(),
    });
    expect(moves.map((move) => [move.kind, move.quantity, move.wasteRefLabel, move.reason])).toEqual([
      ['wasted', -1000, 'Sintraboard Photo Print — A3', 'misprint'],
      ['wasted', -2000, 'Sintraboard Photo Print — A3', 'misprint'],
    ]);
    expect(await onHand(h, h.hook.id)).toBe(10_000);
    expect(await onHand(h, h.boardA3.id)).toBe(4000);
  });

  it('pages an item’s history, newest first', async () => {
    const h = harness();
    const hook = await h.catalogue.saveItem(SCOPE, ANA, { kind: 'material', name: 'Hook', unit: 'piece' });
    for (let i = 0; i < 3; i += 1)
      await h.moves.receive(SCOPE, ANA, { stockItemId: hook.id, quantity: 1000, clientId: press() });
    const page = await h.moves.moves(SCOPE, hook.id, null);
    expect(page.moves).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
    const older = await h.moves.moves(SCOPE, hook.id, page.moves[0]?.id ?? null);
    expect(older.moves).toHaveLength(2);
  });
});

describe('stock items and lists', () => {
  it('⚠ fixes the unit once stock has moved', async () => {
    const h = harness();
    const paper = await h.catalogue.saveItem(SCOPE, ANA, { kind: 'material', name: 'Paper', unit: 'sheet' });
    await h.catalogue.saveItem(SCOPE, ANA, { id: paper.id, kind: 'material', name: 'Paper', unit: 'pack' });
    await h.moves.receive(SCOPE, ANA, { stockItemId: paper.id, quantity: 1000, clientId: press() });
    expect(
      await reason(h.catalogue.saveItem(SCOPE, ANA, { id: paper.id, kind: 'material', name: 'Paper', unit: 'sheet' })),
    ).toBe('unit_in_use');
  });

  it('keeps codes unique per store, and stops at the cap', async () => {
    const h = harness({
      limits: { check: async ({ current }) => ({ allowed: current < 1, limit: 1, current, remaining: 0 }) },
    });
    await h.catalogue.saveItem(SCOPE, ANA, { kind: 'material', name: 'A', unit: 'piece', code: 'x-1' });
    expect(await reason(h.catalogue.saveItem(SCOPE, ANA, { kind: 'material', name: 'B', unit: 'piece' }))).toBe(
      'limit_reached',
    );
  });

  it('refuses a list without a point of sale, or for a product it does not sell', async () => {
    const none = harness({ source: null });
    const hook = await none.catalogue.saveItem(SCOPE, ANA, { kind: 'material', name: 'Hook', unit: 'piece' });
    expect(
      await reason(
        none.catalogue.setUses(SCOPE, ANA, { refKind: 'item', refId: 'sintra', refItemId: 'sintra' }, [
          { stockItemId: hook.id, quantityPerUnit: 1000 },
        ]),
      ),
    ).toBe('no_source');
    const h = harness();
    const peg = await h.catalogue.saveItem(SCOPE, ANA, { kind: 'material', name: 'Peg', unit: 'piece' });
    expect(
      await reason(
        h.catalogue.setUses(SCOPE, ANA, { refKind: 'item', refId: 'ghost', refItemId: 'ghost' }, [
          { stockItemId: peg.id, quantityPerUnit: 1000 },
        ]),
      ),
    ).toBe('not_found');
  });

  it('creates for-sale items from POS products, linked one to one, and skips services and repeats (I17)', async () => {
    const h = harness();
    expect(await reason(h.catalogue.createFromSource(SCOPE, ANA, [{ itemId: 'layout', variantId: null }]))).toBe(
      'not_found',
    );
    const overview = await h.catalogue.createFromSource(SCOPE, ANA, [{ itemId: 'mug', variantId: null }]);
    expect(overview.items.map((item) => [item.name, item.kind, item.onHand])).toEqual([['Mug 11 oz', 'for_sale', 0]]);
    expect(overview.uses.map((use) => [use.refId, use.quantityPerUnit])).toEqual([['mug', 1000]]);
    expect(await reason(h.catalogue.createFromSource(SCOPE, ANA, [{ itemId: 'mug', variantId: null }]))).toBe(
      'no_change',
    );
  });
});

describe('stock takes', () => {
  it('⚠ confirms against on hand at confirmation, writing only what differs', async () => {
    const h = await sintraboardStore();
    const take = await h.takes.start(SCOPE, ANA, { categoryIds: [] });
    expect(await reason(h.takes.start(SCOPE, ANA, { categoryIds: [] }))).toBe('take_open');
    await h.takes.saveCounts(SCOPE, ANA, take.id, [
      { stockItemId: h.hook.id, counted: 7000 },
      { stockItemId: h.mug.id, counted: 6000 },
    ]);
    // A sale between opening the sheet and confirming it: one hook gone.
    await h.intake.apply(SCOPE, [{ ...SOLD_A3, quantity: 1 }]);
    const confirmed = await h.takes.confirm(SCOPE, ANA, take.id);
    expect(confirmed.status).toBe('confirmed');
    expect(await onHand(h, h.hook.id)).toBe(7000);
    expect(await onHand(h, h.mug.id)).toBe(6000);
    const hookLine = confirmed.lines.find((line) => line.stockItemId === h.hook.id);
    expect([hookLine?.onHand, hookLine?.difference]).toEqual([9000, -2000]);
    expect(await reason(h.takes.confirm(SCOPE, ANA, take.id))).toBe('take_closed');
  });

  it('refuses a fraction of a piece on the sheet', async () => {
    const h = await sintraboardStore();
    const take = await h.takes.start(SCOPE, ANA, { categoryIds: [] });
    expect(await reason(h.takes.saveCounts(SCOPE, ANA, take.id, [{ stockItemId: h.hook.id, counted: 1500 }]))).toBe(
      'whole_units_only',
    );
  });
});
