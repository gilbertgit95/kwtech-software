/**
 * The printing shop's price list, as the point of sale's catalogue.
 *
 * A product decision, not reference data: it is the operator's spreadsheet
 * (2026-09-30), and once seeded the store owns it — prices change on the item
 * screen, never here. That is why `pos:catalogue` is a `seed` seeder that only
 * CREATES what is missing (see the seeder).
 *
 * ⚠ PRICES ARE PESOS HERE, for reading against the spreadsheet; the seeder
 * turns them into centavos. Everywhere past the seeder a price is centavos.
 *
 * ⚠ CODES ARE UNIQUE PER STORE ACROSS ITEMS AND VARIANTS, and they are how a
 * re-run recognises what it already made. Change a code and the next run makes
 * a second item.
 */

export interface SeedPosVariant {
  name: string;
  code: string;
  /** Pesos. */
  price: number;
}

export interface SeedPosItem {
  kind: 'product' | 'service';
  name: string;
  code: string;
  description: string;
  /** Pesos. Unused when the item has variants: the till asks for one. */
  price: number;
  variants?: readonly SeedPosVariant[];
}

export interface SeedPosCategory {
  name: string;
  items: readonly SeedPosItem[];
}

const PAPER_SIZES = [
  { name: 'A4', code: 'A4' },
  { name: 'Short', code: 'SH' },
  { name: 'Long', code: 'LG' },
] as const;

/**
 * Colour × paper × ink coverage, in the till's picker order, from one price
 * table per colour: `[minimal, full]` per paper size, A4 / Short / Long.
 */
function coverageVariants(
  prefix: string,
  table: Record<'B&W' | 'Colored', readonly (readonly [number, number])[]>,
): SeedPosVariant[] {
  const colours = [
    { name: 'B&W', code: 'BW' },
    { name: 'Colored', code: 'CL' },
  ] as const;
  return colours.flatMap((colour) =>
    PAPER_SIZES.flatMap((paper, index) => {
      const [minimal, full] = table[colour.name][index] ?? [0, 0];
      return [
        {
          name: `${colour.name} · ${paper.name} · Minimal`,
          code: `${prefix}-${colour.code}-${paper.code}-MIN`,
          price: minimal,
        },
        {
          name: `${colour.name} · ${paper.name} · Full`,
          code: `${prefix}-${colour.code}-${paper.code}-FULL`,
          price: full,
        },
      ];
    }),
  );
}

export const POS_SEED_CATALOGUE: readonly SeedPosCategory[] = [
  {
    name: 'Printing & Copying',
    items: [
      {
        kind: 'service',
        name: 'Document Printing',
        code: 'DOC',
        description:
          'Per page, printed from the customer’s file. Minimal is mostly text; Full is heavy ink, photos or full-page colour.',
        price: 0,
        variants: coverageVariants('DOC', {
          'B&W': [
            [3, 4],
            [3, 4],
            [4, 5],
          ],
          Colored: [
            [7, 8],
            [7, 8],
            [8, 9],
          ],
        }),
      },
      {
        kind: 'service',
        name: 'Photocopy',
        code: 'PC',
        description:
          'Per page, copied from the customer’s original. Minimal is mostly text; Full is heavy ink, photos or full-page colour.',
        price: 0,
        variants: coverageVariants('PC', {
          'B&W': [
            [2, 3],
            [2, 3],
            [3, 4],
          ],
          Colored: [
            [6, 7],
            [6, 7],
            [7, 8],
          ],
        }),
      },
      {
        kind: 'service',
        name: 'Scan',
        code: 'SCAN',
        description: 'Per page, scanned to a digital file for the customer.',
        price: 0,
        variants: [
          { name: 'A4', code: 'SCAN-A4', price: 8 },
          { name: 'Short / Letter', code: 'SCAN-SH', price: 8 },
          { name: 'Long / Legal', code: 'SCAN-LG', price: 9 },
        ],
      },
      {
        kind: 'service',
        name: 'Manual Labor',
        code: 'LABOR',
        /*
         * The spreadsheet's "minimum of 15, depending on complexity or effort".
         * The till has no open price yet (POS-PLAN §7, "open-price items"), so
         * the item carries the minimum and the description says so.
         */
        description:
          'Hand work such as cutting, binding, layout or editing. Minimum ₱15; the final price depends on the complexity and effort of the job.',
        price: 15,
      },
    ],
  },
  {
    name: 'Lamination',
    items: [
      {
        kind: 'service',
        name: 'Lamination',
        code: 'LAM',
        /*
         * The spreadsheet's rule, "for Whole sizes, if more than 2 items then
         * less 5 from second to the last items", is not something the till
         * prices on its own: the cashier applies it as a line discount.
         */
        description:
          'Per piece, 125 or 250 micron film. Whole sizes, more than 2 pieces: less ₱5 each from the second piece on.',
        price: 0,
        variants: [
          { name: '125 mic · ID Small', code: 'LAM-125-ID-S', price: 15 },
          { name: '125 mic · ID Big', code: 'LAM-125-ID-B', price: 20 },
          { name: '125 mic · A4 Half', code: 'LAM-125-A4-H', price: 25 },
          { name: '125 mic · A4 Whole', code: 'LAM-125-A4-W', price: 40 },
          { name: '125 mic · Long Whole', code: 'LAM-125-LG-W', price: 45 },
          { name: '250 mic · ID Small', code: 'LAM-250-ID-S', price: 20 },
          { name: '250 mic · ID Big', code: 'LAM-250-ID-B', price: 25 },
          { name: '250 mic · A4 Half', code: 'LAM-250-A4-H', price: 35 },
          { name: '250 mic · A4 Whole', code: 'LAM-250-A4-W', price: 55 },
          { name: '250 mic · Long Whole', code: 'LAM-250-LG-W', price: 65 },
        ],
      },
    ],
  },
  {
    name: 'Photo & ID',
    items: [
      {
        kind: 'service',
        name: 'Rush ID',
        code: 'RUSH-ID',
        description: 'ID photo taken and printed while the customer waits, small package.',
        price: 30,
      },
      {
        kind: 'service',
        name: 'Photo Printing',
        code: 'PHOTO',
        description: 'Glossy photo paper, priced per pack; the pieces per pack depend on the size.',
        price: 0,
        variants: [
          { name: '2R · 8 pcs', code: 'PHOTO-2R', price: 40 },
          { name: '3R · 4 pcs', code: 'PHOTO-3R', price: 35 },
          { name: '4R · 2 pcs', code: 'PHOTO-4R', price: 30 },
          { name: '5R · 2 pcs', code: 'PHOTO-5R', price: 35 },
          { name: '6R · 1 pc', code: 'PHOTO-6R', price: 30 },
          { name: '8R · 1 pc', code: 'PHOTO-8R', price: 35 },
        ],
      },
      {
        kind: 'service',
        name: 'Sintra Board Photo',
        code: 'SINTRA-8R',
        description: 'An 8R photo mounted on a rigid sintra (PVC foam) board, ready to display. One piece.',
        price: 140,
      },
    ],
  },
  {
    name: 'Stickers & Souvenirs',
    items: [
      {
        kind: 'service',
        name: 'Sticker Printing',
        code: 'STK',
        description: 'Per page. Vinyl stickers include a protective phototop layer.',
        price: 0,
        variants: [
          { name: 'Paper', code: 'STK-PAPER', price: 25 },
          { name: 'Vinyl Opaque Glossy', code: 'STK-VIN-OPQ', price: 65 },
          { name: 'Vinyl Transparent Glossy', code: 'STK-VIN-TRN', price: 65 },
        ],
      },
      {
        kind: 'service',
        name: 'PVC ID Printing',
        code: 'PVC-ID-4',
        description: 'ID-size PVC cards, printed. Minimum order of 4 pieces; the price is for the set of 4.',
        price: 160,
      },
      {
        kind: 'service',
        name: 'Ref Magnets',
        code: 'MAG-ATM-8',
        description: 'ATM-card-size refrigerator magnets. Minimum order of 8 pieces; the price is for the set of 8.',
        price: 160,
      },
      {
        kind: 'product',
        name: 'Key Chain',
        code: 'KEYCHAIN-OCT',
        description: 'Octagon acrylic key chain with a printed insert. One piece.',
        price: 25,
      },
    ],
  },
];
