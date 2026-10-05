import {
  borderOf,
  cellOnSheet,
  checkCells,
  checkLayoutVersion,
  DEFAULT_BORDER,
  emptyLayoutSpec,
  prepareLayoutName,
  prepareLayoutSpec,
  printableArea,
  rectsOverlap,
  STUDIO_CELLS_MAX,
  type StudioLayoutSpec,
  sheetSize,
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
