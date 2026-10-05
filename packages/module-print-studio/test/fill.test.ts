import {
  addPage,
  filledCellCount,
  planFill,
  STUDIO_PAGES_MAX,
  setCellPhoto,
  swapCellPhotos,
  usedPhotoIds,
} from '../src/domain/fill.js';

/** Four cells, drawn bottom row first — so reading order is not drawing order. */
const CELLS = [
  { x: 0, y: 100, width: 10, height: 10 },
  { x: 50, y: 100, width: 10, height: 10 },
  { x: 0, y: 0, width: 10, height: 10 },
  { x: 50, y: 0, width: 10, height: 10 },
];
const photos = (count: number) => Array.from({ length: count }, (_photo, index) => `p${index + 1}`);

describe('planFill', () => {
  it('puts the same photo in every cell of one page', () => {
    expect(planFill(CELLS, ['p1', 'p2'], 'same')).toEqual({ pages: [['p1', 'p1', 'p1', 'p1']], dropped: 0 });
  });

  it('fills one photo per cell in reading order', () => {
    // p1 and p2 go on the top row, which was drawn last.
    expect(planFill(CELLS, photos(4), 'sequence').pages).toEqual([['p3', 'p4', 'p1', 'p2']]);
  });

  it('adds a page with the same layout for the photos that are left', () => {
    const { pages, dropped } = planFill(CELLS, photos(10), 'sequence');
    expect(pages).toHaveLength(3);
    expect(pages[2]).toEqual([null, null, 'p9', 'p10']);
    expect(dropped).toBe(0);
  });

  it('gives each photo a page of its own', () => {
    const { pages } = planFill(CELLS, photos(3), 'per_page');
    expect(pages).toEqual([
      ['p1', 'p1', 'p1', 'p1'],
      ['p2', 'p2', 'p2', 'p2'],
      ['p3', 'p3', 'p3', 'p3'],
    ]);
  });

  it('starts by hand with one empty page', () => {
    expect(planFill(CELLS, photos(3), 'manual')).toEqual({ pages: [[null, null, null, null]], dropped: 0 });
  });

  it('gives an empty page when there are no photos yet', () => {
    for (const mode of ['same', 'sequence', 'per_page'] as const) {
      expect(planFill(CELLS, [], mode).pages).toEqual([[null, null, null, null]]);
    }
  });

  it('stops at the page limit and says how many photos found no place', () => {
    const many = photos(STUDIO_PAGES_MAX + 5);
    expect(planFill(CELLS, many, 'per_page')).toMatchObject({ dropped: 5 });
    expect(planFill(CELLS, many, 'per_page').pages).toHaveLength(STUDIO_PAGES_MAX);

    const flood = photos(CELLS.length * STUDIO_PAGES_MAX + 3);
    expect(planFill(CELLS, flood, 'sequence').dropped).toBe(3);
  });

  it('has nowhere to put photos in a layout with no cells', () => {
    expect(planFill([], photos(2), 'sequence')).toEqual({ pages: [], dropped: 2 });
  });
});

describe('changing a fill by hand', () => {
  const pages = planFill(CELLS, photos(4), 'sequence').pages;

  it('sets and clears one cell without touching the pages it was given', () => {
    const before = structuredClone(pages);
    expect(setCellPhoto(pages, 0, 0, 'new')[0]).toEqual(['new', 'p4', 'p1', 'p2']);
    expect(setCellPhoto(pages, 0, 1, null)[0]).toEqual(['p3', null, 'p1', 'p2']);
    expect(setCellPhoto(pages, 0, 9, 'x')).toEqual(before);
    expect(pages).toEqual(before);
  });

  it('swaps two cells, across pages too', () => {
    const two = addPage(pages, CELLS.length) ?? [];
    const swapped = swapCellPhotos(two, { page: 0, cell: 0 }, { page: 1, cell: 2 });
    expect(swapped[0]?.[0]).toBeNull();
    expect(swapped[1]?.[2]).toBe('p3');
  });

  it('refuses a page past the limit', () => {
    const full = Array.from({ length: STUDIO_PAGES_MAX }, () => [null]);
    expect(addPage(full, 1)).toBeNull();
  });

  it('counts filled cells and names each used photo once', () => {
    const { pages: same } = planFill(CELLS, ['p1'], 'same');
    expect(filledCellCount(same)).toBe(4);
    expect(usedPhotoIds(same)).toEqual(['p1']);
    expect(filledCellCount(planFill(CELLS, [], 'manual').pages)).toBe(0);
  });
});
