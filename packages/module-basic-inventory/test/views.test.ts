import {
  itemDraft,
  parseCount,
  validateAdjustDraft,
  validateItemDraft,
  validateUseList,
  validateWasteDraft,
} from '../src/react/view/forms.js';
import {
  afterText,
  quantityText,
  reasonLabel,
  signedQuantityText,
  whenText,
  whoText,
} from '../src/react/view/labels.js';
import {
  canMake,
  filterItems,
  levelFill,
  limitedBy,
  materialsCost,
  needsAttention,
  overlapNames,
  plural,
  productRows,
  stockSummary,
  wasteLinesFor,
} from '../src/react/view/lists.js';
import { formatPeso, parsePeso } from '../src/react/view/money.js';
import type { StockUnit } from '../src/types.js';
import type { StockItemView, StockSourceItemView, StockUseView } from '../src/views.js';

const item = (patch: Partial<StockItemView>): StockItemView => ({
  id: 'i',
  kind: 'material',
  name: 'Item',
  code: null,
  unit: 'piece',
  unitCost: null,
  lowStockAt: null,
  categoryId: null,
  archivedAt: null,
  onHand: 0,
  level: 'out',
  value: null,
  usedBy: 0,
  ...patch,
});

const ITEMS = [
  item({ id: 'hook', name: 'Hook', onHand: 3000, level: 'ok', unitCost: 500 }),
  item({ id: 'board', name: 'Sintraboard A3', onHand: 12_000, level: 'ok', unitCost: 8000, categoryId: 'boards' }),
  item({ id: 'vinyl', name: 'Vinyl', unit: 'sheet', onHand: 1000, level: 'low', unitCost: 1500 }),
  item({ id: 'mug', name: 'Mug', kind: 'for_sale', onHand: -1000, level: 'negative' }),
  item({ id: 'old', name: 'Old paper', archivedAt: '2026-01-01T00:00:00.000Z' }),
];

const use = (
  refKind: 'item' | 'variant',
  refId: string,
  stockItemId: string,
  quantityPerUnit: number,
): StockUseView => ({
  id: `${refId}-${stockItemId}`,
  refKind,
  refId,
  refItemId: 'sintra',
  refLabel: 'Sintraboard',
  stockItemId,
  quantityPerUnit,
});
const USES = [
  use('item', 'sintra', 'hook', 1000),
  use('variant', 'a3', 'board', 1000),
  use('variant', 'a3', 'vinyl', 2000),
];

describe('the stock list', () => {
  it('filters by level, kind, category and words, and never shows archived items', () => {
    expect(filterItems(ITEMS, 'all', null, '').map((one) => one.id)).toEqual(['hook', 'board', 'vinyl', 'mug']);
    expect(filterItems(ITEMS, 'low', null, '').map((one) => one.id)).toEqual(['vinyl', 'mug']);
    expect(filterItems(ITEMS, 'out', null, '').map((one) => one.id)).toEqual(['mug']);
    expect(filterItems(ITEMS, 'for_sale', null, '').map((one) => one.id)).toEqual(['mug']);
    expect(filterItems(ITEMS, 'all', 'boards', '').map((one) => one.id)).toEqual(['board']);
    expect(filterItems(ITEMS, 'all', null, 'a3 sintra').map((one) => one.id)).toEqual(['board']);
    expect(needsAttention(ITEMS)).toBe(2);
  });
});

describe('the products', () => {
  const source: StockSourceItemView[] = [
    {
      itemId: 'sintra',
      variantId: null,
      itemName: 'Sintraboard',
      variantName: null,
      kind: 'service',
      code: null,
      archived: false,
      label: 'Sintraboard',
    },
    {
      itemId: 'sintra',
      variantId: 'a3',
      itemName: 'Sintraboard',
      variantName: 'A3',
      kind: 'service',
      code: null,
      archived: false,
      label: 'Sintraboard — A3',
    },
    {
      itemId: 'old',
      variantId: null,
      itemName: 'Aardvark',
      variantName: null,
      kind: 'product',
      code: null,
      archived: true,
      label: 'Aardvark',
    },
  ];

  it('groups variants under their item, counts list lines, and puts archived ones last', () => {
    expect(productRows(source, USES).map((row) => [row.itemId, row.variants.length, row.lines])).toEqual([
      ['sintra', 1, 3],
      ['old', 0, 0],
    ]);
  });

  it('works out how many can still be made, what the materials cost, and a waste’s lines', () => {
    const overview = { items: ITEMS, uses: USES };
    expect(canMake(overview, 'sintra', 'a3')).toBe(0);
    expect(materialsCost(overview, 'sintra', 'a3')).toBe(500 + 8000 + 3000);
    expect(wasteLinesFor(USES, 'sintra', 'a3', 1)).toEqual([
      { key: 'board', stockItemId: 'board', quantity: '1' },
      { key: 'hook', stockItemId: 'hook', quantity: '1' },
      { key: 'vinyl', stockItemId: 'vinyl', quantity: '2' },
    ]);
  });

  it('names a material on both the item’s and a variant’s list', () => {
    expect(overlapNames([...USES, use('variant', 'a3', 'hook', 1000)], 'sintra', ITEMS)).toEqual(['Hook']);
  });
});

describe('the forms', () => {
  const unitOf = (id: string): StockUnit | null => ITEMS.find((one) => one.id === id)?.unit ?? null;

  it('checks a stock item as the server does, and sends a cost in centavos', () => {
    const draft = { ...itemDraft(null), name: 'Photo top', unit: 'sheet', unitCost: '4.20', lowStockAt: '10' };
    expect(validateItemDraft(draft, null)).toEqual({
      ok: true,
      input: expect.objectContaining({
        name: 'Photo top',
        unit: 'sheet',
        unitCost: 420,
        lowStockAt: 10_000,
        code: null,
      }),
    });
    expect(validateItemDraft({ ...draft, lowStockAt: '0.5' }, null)).toEqual({
      ok: false,
      errors: { lowStockAt: 'Sheets are counted whole.' },
    });
  });

  it('turns an adjustment out into a negative quantity, and needs a note for “other”', () => {
    const hook = ITEMS[0] ?? null;
    expect(
      validateAdjustDraft(
        { stockItemId: 'hook', direction: 'out', quantity: '2', reason: 'lost', note: '' },
        hook,
        'c1',
      ),
    ).toEqual({
      ok: true,
      input: { stockItemId: 'hook', quantity: -2000, reason: 'lost', note: null, clientId: 'c1' },
    });
    expect(
      validateAdjustDraft(
        { stockItemId: 'hook', direction: 'in', quantity: '1', reason: 'other', note: ' ' },
        hook,
        'c1',
      ),
    ).toEqual({ ok: false, errors: { note: 'Say what happened.' } });
  });

  it('drops waste lines cleared to nothing — the hook was not used yet', () => {
    const result = validateWasteDraft(
      {
        lines: [
          { key: 'board', stockItemId: 'board', quantity: '1' },
          { key: 'hook', stockItemId: 'hook', quantity: '' },
          { key: 'vinyl', stockItemId: 'vinyl', quantity: '0' },
        ],
        reason: 'misprint',
        note: '',
      },
      unitOf,
      { refId: 'a3', refLabel: 'Sintraboard — A3' },
      'c2',
    );
    expect(result).toEqual({
      ok: true,
      input: expect.objectContaining({ lines: [{ stockItemId: 'board', quantity: 1000 }], ofRefId: 'a3' }),
    });
  });

  it('refuses the same material twice on a list', () => {
    expect(
      validateUseList(
        [
          { stockItemId: 'hook', quantity: '1' },
          { stockItemId: 'hook', quantity: '2' },
        ],
        unitOf,
      ),
    ).toEqual({ ok: false, error: 'Each stock item appears once — change its quantity instead.' });
    expect(validateUseList([{ stockItemId: '', quantity: '' }], unitOf)).toEqual({ ok: true, lines: [] });
  });

  it('reads a count: empty is not counted, zero is an empty shelf', () => {
    expect(parseCount('', 'piece')).toEqual({ counted: null });
    expect(parseCount('0', 'piece')).toEqual({ counted: 0 });
    expect(parseCount('12', 'piece')).toEqual({ counted: 12_000 });
    expect(parseCount('1.5', 'piece')).toEqual({ error: 'Pieces are counted whole.' });
  });
});

describe('labels and money', () => {
  it('prints quantities with their unit and sign', () => {
    expect(quantityText(1500, 'm')).toBe('1.5 m');
    expect(signedQuantityText(2000, 'sheet')).toBe('+2 sheets');
    expect(signedQuantityText(-1000, 'piece')).toBe('-1 piece');
    expect(reasonLabel('misprint')).toBe('Misprint');
    expect(reasonLabel('found')).toBe('Found');
  });

  it('names a sale’s movement as the point of sale’s, and a stranger as a team member', () => {
    expect(whoText({ createdById: null, createdByName: null })).toBe('Point of sale');
    expect(whoText({ createdById: 'u', createdByName: null })).toBe('A team member');
  });

  it('⚠ dates a movement in the workspace’s zone, not the browser’s', () => {
    const at = '2026-10-21T17:30:00.000Z';
    expect(whenText(at, 'Asia/Manila')).toContain('Oct 22, 2026');
    expect(whenText(at, 'Europe/London')).toContain('Oct 21, 2026');
  });

  it('parses a typed cost from the text, never through a float', () => {
    expect(parsePeso('0.29')).toBe(29);
    expect(parsePeso('₱1,500.50')).toBe(150_050);
    expect(parsePeso('-1')).toBeNull();
    expect(formatPeso(420)).toBe('₱4.20');
  });
});

describe('the new summaries', () => {
  it('names the material a product runs out of first', () => {
    expect(limitedBy({ items: ITEMS, uses: USES }, 'sintra', 'a3')).toBe('Vinyl');
    expect(limitedBy({ items: ITEMS, uses: USES }, 'nothing', null)).toBeNull();
  });

  it('sums the stock list and fills a bar against twice the low level', () => {
    expect(stockSummary({ items: ITEMS, totalValue: 100, unvalued: 1 })).toEqual({
      items: 4,
      low: 1,
      out: 1,
      value: 100,
      unvalued: 1,
    });
    expect(levelFill({ onHand: 5000, lowStockAt: 5000 })).toBe(0.5);
    expect(levelFill({ onHand: 50_000, lowStockAt: 5000 })).toBe(1);
    expect(levelFill({ onHand: -1000, lowStockAt: 5000 })).toBe(0);
    expect(levelFill({ onHand: 5000, lowStockAt: null })).toBeNull();
  });

  it('says counts with their noun, and what a movement leaves', () => {
    expect(plural(1, 'list')).toBe('1 list');
    expect(plural(3, 'list')).toBe('3 lists');
    expect(afterText(6000, 10_000, 'piece')).toBe('6 → 16 pieces');
  });
});
