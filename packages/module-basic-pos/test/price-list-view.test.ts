import type { PosCatalogueView, PosItemView } from '../src/react/pos-client.js';
import {
  PRICE_LIST_MARGIN,
  PRICE_LIST_OTHER,
  PRICE_LIST_PAPERS,
  type PriceListSection,
  paperPoints,
  priceListCsvRows,
  priceListFileName,
  priceListHtml,
  priceListPages,
  priceListRowHeight,
  priceListSections,
} from '../src/react/view/price-list.js';

function item(patch: Partial<PosItemView> & Pick<PosItemView, 'id' | 'name'>): PosItemView {
  return {
    kind: 'product',
    code: null,
    description: null,
    price: 1000,
    cost: 400,
    categoryId: null,
    archivedAt: null,
    variants: [],
    ...patch,
  };
}

const CATALOGUE: PosCatalogueView = {
  costsVisible: true,
  orderTypes: [],
  categories: [
    { id: 'c-print', name: 'Printing', sortOrder: 1, archivedAt: null },
    { id: 'c-lam', name: 'Lamination', sortOrder: 0, archivedAt: null },
    { id: 'c-old', name: 'Old stuff', sortOrder: 2, archivedAt: '2026-01-01' },
    { id: 'c-empty', name: 'Empty', sortOrder: 3, archivedAt: null },
  ],
  items: [
    item({ id: 'bw', name: 'B/W print', code: 'BW', price: 300, categoryId: 'c-print' }),
    item({ id: 'color', name: 'Colour print', price: 1500, categoryId: 'c-print', description: 'Per page' }),
    item({
      id: 'lam',
      name: 'Lamination',
      kind: 'service',
      code: 'LAM',
      price: 0,
      categoryId: 'c-lam',
      variants: [
        { id: 'v2', itemId: 'lam', name: 'A4', code: null, price: 4000, cost: 900, sortOrder: 1, archivedAt: null },
        { id: 'v1', itemId: 'lam', name: 'ID', code: 'L1', price: 2000, cost: 500, sortOrder: 0, archivedAt: null },
        {
          id: 'vx',
          itemId: 'lam',
          name: 'Gone',
          code: null,
          price: 1,
          cost: null,
          sortOrder: 2,
          archivedAt: '2026-01-01',
        },
      ],
    }),
    item({ id: 'mag', name: 'Ref magnet', price: 16000, categoryId: 'c-old' }),
    item({ id: 'pen', name: '<b>Pen</b>', price: 2500 }),
    item({ id: 'arch', name: 'Archived item', archivedAt: '2026-01-01', categoryId: 'c-print' }),
    item({
      id: 'novar',
      name: 'All variants gone',
      categoryId: 'c-print',
      variants: [
        {
          id: 'g',
          itemId: 'novar',
          name: 'X',
          code: null,
          price: 1,
          cost: null,
          sortOrder: 0,
          archivedAt: '2026-01-01',
        },
      ],
    }),
  ],
};

describe('price list', () => {
  it('lists what the till sells by category order, items by name, and the rest under Other', () => {
    const sections = priceListSections(CATALOGUE);
    expect(sections.map((section) => section.title)).toEqual(['Lamination', 'Printing', PRICE_LIST_OTHER]);
    expect(sections[1]?.items.map((row) => row.name)).toEqual(['B/W print', 'Colour print']);
    // An archived category's items, and those with none, are still for sale.
    expect(sections[2]?.items.map((row) => row.name)).toEqual(['<b>Pen</b>', 'Ref magnet']);
    expect(sections[0]?.items[0]?.variants).toEqual([
      { name: 'ID', code: 'L1', price: 2000 },
      { name: 'A4', code: null, price: 4000 },
    ]);
  });

  it('prints escaped names and prices, never costs, with the date in the store zone', () => {
    const html = priceListHtml(CATALOGUE, new Date('2026-10-16T17:00:00Z'), 'Asia/Manila');
    expect(html).toContain('Oct 17, 2026');
    expect(html).toContain('₱160.00');
    expect(html).toContain('&#60;b&#62;Pen&#60;/b&#62;');
    expect(html).not.toContain('<b>Pen');
    expect(html).not.toContain('Archived item');
    expect(html).not.toContain('Gone');
    expect(html).not.toContain('₱4.00');
  });

  it('says so when there is nothing to list', () => {
    expect(priceListHtml({ ...CATALOGUE, items: [] }, new Date(), 'Asia/Manila')).toContain('No items to list.');
  });

  it('writes one CSV row per thing rung up, in pesos, a variant falling back to its item code', () => {
    expect(priceListCsvRows(CATALOGUE)).toEqual([
      ['Category', 'Item', 'Variant', 'Code', 'Price (PHP)'],
      ['Lamination', 'Lamination', 'ID', 'L1', 20],
      ['Lamination', 'Lamination', 'A4', 'LAM', 40],
      ['Printing', 'B/W print', null, 'BW', 3],
      ['Printing', 'Colour print', null, null, 15],
      [PRICE_LIST_OTHER, '<b>Pen</b>', null, null, 25],
      [PRICE_LIST_OTHER, 'Ref magnet', null, null, 160],
    ]);
    expect(priceListFileName('2026-10-17')).toBe('pos-price-list-2026-10-17.csv');
  });
});

describe('price list pages, for a printer', () => {
  const A4 = paperPoints(PRICE_LIST_PAPERS[0].width);
  const A4_HEIGHT = paperPoints(PRICE_LIST_PAPERS[0].height);

  it('measures A4 in points', () => {
    expect(A4).toBeCloseTo(595.28, 1);
    expect(A4_HEIGHT).toBeCloseTo(841.89, 1);
  });

  it('puts a short list on one page, heading first, prices as the till prints them', () => {
    const pages = priceListPages(priceListSections(CATALOGUE), 'Prices as of now', A4_HEIGHT);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.footer).toBe('Page 1 of 1');
    const rows = pages[0]?.rows.map(({ row }) => row) ?? [];
    expect(rows[0]).toEqual({ kind: 'heading', title: 'Price list', subtitle: 'Prices as of now' });
    expect(rows[1]).toEqual({ kind: 'section', title: 'Lamination' });
    // An item with variants has no price of its own; each variant has one.
    expect(rows[2]).toMatchObject({ kind: 'item', name: 'Lamination', price: null });
    expect(rows[3]).toEqual({ kind: 'variant', name: 'ID', code: 'L1', price: '₱20.00' });
    expect(rows.find((row) => row.kind === 'item' && row.name === 'Colour print')).toMatchObject({
      note: 'Per page',
      price: '₱15.00',
    });
  });

  it('carries a long list over, saying so, and never leaves a heading at the foot of a page', () => {
    const long: PriceListSection[] = [
      {
        title: 'Printing',
        items: Array.from({ length: 80 }, (_, at) => ({
          name: `Item ${at}`,
          code: null,
          description: null,
          price: 100 * at,
          variants: [],
        })),
      },
      {
        title: 'Lamination',
        items: [
          {
            name: 'Lamination',
            code: null,
            description: null,
            price: 0,
            variants: Array.from({ length: 60 }, (_, at) => ({ name: `Size ${at}`, code: null, price: 1000 })),
          },
        ],
      },
    ];
    const pages = priceListPages(long, 'x', A4_HEIGHT);
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.map((page) => page.footer).at(-1)).toBe(`Page ${pages.length} of ${pages.length}`);
    for (const page of pages) {
      const last = page.rows.at(-1);
      if (!last) throw new Error('A page with no rows.');
      expect(last.row.kind === 'variant' || (last.row.kind === 'item' && last.row.price !== null)).toBe(true);
      // Inside the margin and above the footer.
      expect(last.top + priceListRowHeight(last.row)).toBeLessThanOrEqual(A4_HEIGHT - PRICE_LIST_MARGIN);
    }
    expect(pages[1]?.rows[0]?.row).toEqual({ kind: 'section', title: 'Printing (continued)' });
    const variantsCarried = pages.find((page) =>
      page.rows.some(({ row }) => row.kind === 'item' && row.name === 'Lamination (continued)'),
    );
    expect(variantsCarried?.rows[0]?.row).toEqual({ kind: 'section', title: 'Lamination (continued)' });
    // Every item and variant is on some page, once.
    const names = pages.flatMap((page) => page.rows.map(({ row }) => ('name' in row ? row.name : null)));
    expect(names.filter((name) => name?.startsWith('Item '))).toHaveLength(80);
    expect(names.filter((name) => name?.startsWith('Size '))).toHaveLength(60);
  });

  it('says so when there is nothing to list', () => {
    const pages = priceListPages([], 'x', A4_HEIGHT);
    expect(pages[0]?.rows.map(({ row }) => row.kind)).toEqual(['heading', 'section']);
  });
});
