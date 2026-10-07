import {
  borderOf,
  cellOnSheet,
  checkCells,
  checkLayoutOnPaper,
  checkLayoutVersion,
  DEFAULT_BORDER,
  emptyLayoutSpec,
  layoutOnPage,
  prepareLayoutName,
  prepareLayoutSpec,
  printableArea,
  rectsOverlap,
  STUDIO_CELLS_MAX,
  type StudioLayoutSpec,
  scaleCells,
  sheetSize,
  sizingOf,
} from '../src/domain/layout.js';
import { inches, mm } from '../src/domain/units.js';

const FOUR_R = { key: '4r', label: '4R', width: inches(4), height: inches(6) };

function spec(overrides: Partial<StudioLayoutSpec> = {}): StudioLayoutSpec {
  return { ...emptyLayoutSpec(FOUR_R, mm(3)), ...overrides };
}

describe('the sheet and its printable area', () => {
  it('turns the paper for landscape', () => {
    expect(sheetSize(spec())).toEqual({ width: inches(4), height: inches(6) });
    expect(sheetSize(spec({ orientation: 'landscape' }))).toEqual({ width: inches(6), height: inches(4) });
  });

  it('takes each margin off its own side', () => {
    const area = printableArea(spec({ margins: { top: mm(5), right: mm(2), bottom: mm(10), left: mm(3) } }));
    expect(area).toEqual({ x: mm(3), y: mm(5), width: inches(4) - mm(5), height: inches(6) - mm(15) });
  });

  it('places a cell on the sheet by adding the left and top margins', () => {
    const layout = spec({ margins: { top: mm(5), right: 0, bottom: 0, left: mm(3) } });
    expect(cellOnSheet(layout, { x: 100, y: 200, width: 2540, height: 2540 })).toEqual({
      x: mm(3) + 100,
      y: mm(5) + 200,
      width: 2540,
      height: 2540,
    });
  });
});

describe('checkCells', () => {
  const area = { width: mm(100), height: mm(100) };

  it('lets cells touch but not overlap', () => {
    const left = { x: 0, y: 0, width: mm(50), height: mm(50) };
    expect(checkCells([left, { x: mm(50), y: 0, width: mm(50), height: mm(50) }], area)).toBeNull();
    expect(checkCells([left, { x: mm(50) - 1, y: 0, width: mm(50), height: mm(50) }], area)).toBe('cell_overlap');
    expect(rectsOverlap(left, { x: mm(50), y: 0, width: 1, height: 1 })).toBe(false);
  });

  it('refuses a cell that leaves the area by one unit', () => {
    expect(checkCells([{ x: mm(50) + 1, y: 0, width: mm(50), height: mm(50) }], area)).toBe('cell_outside');
    expect(checkCells([{ x: -1, y: 0, width: mm(50), height: mm(50) }], area)).toBe('cell_outside');
  });

  it('refuses a cell too small to be a photo, and too many cells', () => {
    expect(checkCells([{ x: 0, y: 0, width: mm(5) - 1, height: mm(10) }], area)).toBe('cell_too_small');
    const many = Array.from({ length: STUDIO_CELLS_MAX + 1 }, () => ({ x: 0, y: 0, width: mm(5), height: mm(5) }));
    expect(checkCells(many, area)).toBe('too_many_cells');
  });
});

describe('prepareLayoutSpec', () => {
  it('accepts a spec and keeps only the fields it knows', () => {
    const input = {
      ...spec({ cells: [{ x: 0, y: 0, width: inches(1), height: inches(1), label: ' 1 × 1 ' }] }),
      owner: 'somebody',
    };
    const result = prepareLayoutSpec(JSON.parse(JSON.stringify(input)));
    expect(result).toEqual({
      spec: spec({ cells: [{ x: 0, y: 0, width: inches(1), height: inches(1), label: '1 × 1' }] }),
    });
  });

  it.each([
    ['a missing version', { version: 2 }, 'invalid_spec'],
    ['a landscape-shaped paper', { paper: { ...FOUR_R, width: inches(6), height: inches(4) } }, 'invalid_paper'],
    ['a paper past the largest', { paper: { ...FOUR_R, height: mm(2001) } }, 'invalid_paper'],
    ['a fractional length', { paper: { ...FOUR_R, width: 10160.5 } }, 'invalid_paper'],
    ['a negative margin', { margins: { top: -1, right: 0, bottom: 0, left: 0 } }, 'invalid_margins'],
    [
      'margins that swallow the sheet',
      { margins: { top: 0, right: inches(2), bottom: 0, left: inches(2) } },
      'no_printable_area',
    ],
    ['an orientation it has not heard of', { orientation: 'sideways' }, 'invalid_spec'],
    ['a cell that is not an object', { cells: [7] }, 'invalid_spec'],
    [
      'a cell outside the printable area',
      { cells: [{ x: 0, y: 0, width: inches(4), height: inches(1) }] },
      'cell_outside',
    ],
  ])('refuses %s', (_name, overrides, reason) => {
    expect(prepareLayoutSpec({ ...spec(), ...overrides })).toEqual({ refused: reason });
  });

  it('refuses a list of cells past the cap without reading them', () => {
    const cells = Array.from({ length: STUDIO_CELLS_MAX + 1 }, () => 'not a cell');
    expect(prepareLayoutSpec({ ...spec(), cells })).toEqual({ refused: 'too_many_cells' });
  });

  it('refuses anything that is not an object', () => {
    expect(prepareLayoutSpec(null)).toEqual({ refused: 'invalid_spec' });
    expect(prepareLayoutSpec('{}')).toEqual({ refused: 'invalid_spec' });
    expect(prepareLayoutSpec([])).toEqual({ refused: 'invalid_spec' });
  });
});

describe('the border around the cells', () => {
  it('is the default hairline when a layout has none of its own', () => {
    expect(borderOf(spec())).toEqual(DEFAULT_BORDER);
    expect(DEFAULT_BORDER).toEqual({ style: 'solid', width: 8, color: 'grey' });
  });

  it('is kept when a layout chooses one', () => {
    const border = { style: 'dashed', width: mm(0.5), color: 'black' } as const;
    const result = prepareLayoutSpec({ ...spec(), border });
    expect('spec' in result && borderOf(result.spec)).toEqual(border);
  });

  it('reads a null or absent border as "the default", and stores none', () => {
    for (const border of [null, undefined]) {
      const result = prepareLayoutSpec({ ...spec(), border });
      expect('spec' in result && 'border' in result.spec).toBe(false);
    }
  });

  it.each([
    ['a style it has not heard of', { style: 'dotted', width: 10, color: 'grey' }],
    ['a colour it has not heard of', { style: 'solid', width: 10, color: 'red' }],
    ['a line too thin to print', { style: 'solid', width: 1, color: 'grey' }],
    ['a line 5 mm thick', { style: 'solid', width: mm(5), color: 'grey' }],
    ['a fractional width', { style: 'solid', width: 10.5, color: 'grey' }],
    ['something that is not a border', 'thick'],
  ])('refuses %s', (_name, border) => {
    expect(prepareLayoutSpec({ ...spec(), border })).toEqual({ refused: 'invalid_spec' });
  });
});

describe('names and versions', () => {
  it('trims a name to one clean line', () => {
    expect(prepareLayoutName('  ID  package\n4R ')).toEqual({ name: 'ID package 4R' });
  });

  it('refuses an empty or over-long name', () => {
    expect(prepareLayoutName('   ')).toEqual({ refused: 'invalid_name' });
    expect(prepareLayoutName('x'.repeat(81))).toEqual({ refused: 'invalid_name' });
    expect(prepareLayoutName(7)).toEqual({ refused: 'invalid_name' });
  });

  it('refuses a save from an older version', () => {
    expect(checkLayoutVersion(3, 3)).toBeNull();
    expect(checkLayoutVersion(2, 3)).toBe('conflict');
  });
});

describe('checkLayoutOnPaper', () => {
  const A4 = { key: 'a4', label: 'A4', width: mm(210), height: mm(297) };
  const FOLIO = { key: 'folio', label: 'Long bond', width: inches(8.5), height: inches(13) };
  // One cell reaching the bottom right corner of A4's printable area at 5 mm margins.
  const full = { ...emptyLayoutSpec(A4, mm(5)), cells: [{ x: 0, y: 0, width: mm(200), height: mm(287) }] };

  it('allows the paper the layout was made on, and any paper its cells still fit on', () => {
    expect(checkLayoutOnPaper(full, A4)).toBeNull();
    // Long bond is wider and taller than A4.
    expect(checkLayoutOnPaper(full, FOLIO)).toBeNull();
  });

  it('⚠ refuses a paper a cell would hang over the edge of, by one unit', () => {
    expect(checkLayoutOnPaper(full, { ...A4, width: mm(210) - 1 })).toBe('cell_outside');
    expect(checkLayoutOnPaper(full, FOUR_R)).toBe('cell_outside');
  });

  it('measures against the paper as the layout is turned', () => {
    const wide = {
      ...emptyLayoutSpec(FOUR_R, 0),
      orientation: 'landscape' as const,
      cells: [{ x: 0, y: 0, width: inches(6), height: inches(4) }],
    };
    expect(checkLayoutOnPaper(wide, FOUR_R)).toBeNull();
    // 5 inches is the 3R's long side: a 6 inch wide cell does not fit across it.
    expect(checkLayoutOnPaper(wide, { key: '3r', label: '3R', width: inches(3.5), height: inches(5) })).toBe(
      'cell_outside',
    );
  });

  it('refuses a paper the layout’s margins leave nothing of, even with no cells', () => {
    const margins = emptyLayoutSpec(A4, mm(40));
    expect(checkLayoutOnPaper(margins, { key: '2r', label: '2R', width: inches(2.5), height: inches(3.5) })).toBe(
      'no_printable_area',
    );
    expect(checkLayoutOnPaper(margins, A4)).toBeNull();
  });
});

describe('percent layouts', () => {
  const A4 = { key: 'a4', label: 'A4', width: mm(210), height: mm(297) };
  const FOLIO = { key: 'folio', label: 'Long bond', width: inches(8.5), height: inches(13) };
  const TWO_R = { key: '2r', label: '2R', width: inches(2.5), height: inches(3.5) };
  // A4 less 3 mm all round is 204 × 291 mm: two columns of 102, three rows of 97.
  const grid: StudioLayoutSpec = {
    ...emptyLayoutSpec(A4, mm(3)),
    sizing: 'percent',
    cells: [0, 1].flatMap((column) =>
      [0, 1, 2].map((row) => ({ x: column * mm(102), y: row * mm(97), width: mm(102), height: mm(97) })),
    ),
  };

  it('is fixed unless the layout says percent, and stores only percent', () => {
    expect(sizingOf(spec())).toBe('fixed');
    for (const sizing of [undefined, null, 'fixed']) {
      const result = prepareLayoutSpec({ ...spec(), sizing });
      expect('spec' in result && 'sizing' in result.spec).toBe(false);
    }
    const percent = prepareLayoutSpec({ ...spec(), sizing: 'percent' });
    expect('spec' in percent && sizingOf(percent.spec)).toBe('percent');
    expect(prepareLayoutSpec({ ...spec(), sizing: 'elastic' })).toEqual({ refused: 'invalid_spec' });
  });

  it('⚠ leaves a fixed layout’s cells alone on another paper', () => {
    const fixed: StudioLayoutSpec = { ...grid, sizing: 'fixed' };
    const moved = layoutOnPage(fixed, { paper: FOLIO });
    expect(moved.paper).toEqual(FOLIO);
    expect(moved.cells).toEqual(fixed.cells);
  });

  it('resizes a percent layout’s cells to the new printable area, and never the margins', () => {
    const moved = layoutOnPage(grid, { paper: FOLIO });
    const area = printableArea(moved);
    expect(moved.margins).toEqual(grid.margins);
    expect(checkCells(moved.cells, area)).toBeNull();
    // Still the whole area in two columns and three rows: the last cell ends at its corner.
    const last = moved.cells[5];
    expect(last && [last.x + last.width, last.y + last.height]).toEqual([area.width, area.height]);
    // And the first is half the width and a third of the height, to the unit.
    expect(moved.cells[0]).toEqual({ x: 0, y: 0, width: area.width / 2, height: Math.round(area.height / 3) });
  });

  it('⚠ keeps touching cells touching: no gap and no overlap from rounding', () => {
    // 7 columns over a width that does not divide by 7 after scaling.
    const cells = Array.from({ length: 7 }, (_one, index) => ({ x: index * 1000, y: 0, width: 1000, height: 1000 }));
    const scaled = scaleCells(cells, { width: 7000, height: 1000 }, { width: 9999, height: 1501 });
    for (let i = 1; i < scaled.length; i += 1) {
      const before = scaled[i - 1];
      const here = scaled[i];
      expect(before && here && before.x + before.width).toBe(here?.x);
    }
    expect(checkCells(scaled, { width: 9999, height: 1501 })).toBeNull();
  });

  it('follows the orientation and the margins too, as the editor changes them', () => {
    const turned = layoutOnPage(grid, { orientation: 'landscape' });
    expect(checkCells(turned.cells, printableArea(turned))).toBeNull();
    expect(turned.cells[0]?.width).toBe(printableArea(turned).width / 2);

    const wider = layoutOnPage(grid, { margins: { top: mm(3), right: mm(13), bottom: mm(3), left: mm(13) } });
    expect(wider.cells[0]?.width).toBe(mm(92));
  });

  it('comes back to itself from a larger paper', () => {
    expect(layoutOnPage(layoutOnPage(grid, { paper: FOLIO }), { paper: A4 }).cells).toEqual(grid.cells);
  });

  it('⚠ leaves the cells as they were when the page has no room, rather than flatten them', () => {
    const none = layoutOnPage(grid, { margins: { top: 0, right: mm(105), bottom: 0, left: mm(105) } });
    expect(none.cells).toEqual(grid.cells);
  });

  it('may be printed on a paper a fixed layout could not, until a cell would be too small', () => {
    expect(checkLayoutOnPaper({ ...grid, sizing: 'fixed' }, TWO_R)).toBe('cell_outside');
    expect(checkLayoutOnPaper(grid, TWO_R)).toBeNull();
    // Twenty columns across a 2R are under 5 mm each.
    const fine: StudioLayoutSpec = {
      ...grid,
      cells: Array.from({ length: 20 }, (_one, index) => ({ x: index * mm(10), y: 0, width: mm(10), height: mm(10) })),
    };
    expect(checkLayoutOnPaper(fine, A4)).toBeNull();
    expect(checkLayoutOnPaper(fine, TWO_R)).toBe('cell_too_small');
  });
});
