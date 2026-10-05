import { checkCells, type StudioCell } from '../src/domain/layout.js';
import {
  addAt,
  addBlock,
  addOfSize,
  duplicateCell,
  fillWithSize,
  moveCell,
  readingOrder,
  removeCell,
  resizeCell,
  rotateCell,
  snapPosition,
  splitIntoGrid,
} from '../src/domain/place.js';
import { inches, mm } from '../src/domain/units.js';

/** A 4R sheet with 3 mm margins: 95.6 × 146.4 mm to print on. */
const AREA_4R = { width: inches(4) - mm(6), height: inches(6) - mm(6) };
const ONE = { width: inches(1), height: inches(1) };
const TWO = { width: inches(2), height: inches(2) };
const PASSPORT = { width: mm(35), height: mm(45) };
const GAP = { gap: mm(2) };

describe('fillWithSize', () => {
  it('fills a 4R with fifteen 1 × 1 at a 2 mm gap, each exactly one inch', () => {
    const { cells, placed, left } = fillWithSize(AREA_4R, [], ONE, GAP);
    expect(placed).toBe(15);
    expect(left).toBe(0);
    for (const cell of cells) expect([cell.width, cell.height]).toEqual([inches(1), inches(1)]);
    expect(checkCells(cells, AREA_4R)).toBeNull();
  });

  it('keeps the gap between cells and none against the edge', () => {
    const { cells } = fillWithSize(AREA_4R, [], ONE, GAP);
    expect(cells[0]).toMatchObject({ x: 0, y: 0 });
    expect(cells[1]).toMatchObject({ x: inches(1) + mm(2), y: 0 });
    expect(cells[3]).toMatchObject({ x: 0, y: inches(1) + mm(2) });
  });

  it('turns a passport photo on its side when more fit that way', () => {
    const upright = fillWithSize(AREA_4R, [], PASSPORT, { ...GAP, allowRotate: false });
    const either = fillWithSize(AREA_4R, [], PASSPORT, GAP);
    expect(upright.placed).toBe(6);
    expect(either.placed).toBe(8);
    expect(either.cells[0]).toMatchObject({ width: mm(45), height: mm(35) });
    expect(checkCells(either.cells, AREA_4R)).toBeNull();
  });

  it('places nothing when the size is larger than the area', () => {
    expect(fillWithSize(AREA_4R, [], { width: inches(5), height: inches(7) }).placed).toBe(0);
  });

  it('is the same every time', () => {
    expect(fillWithSize(AREA_4R, [], PASSPORT, GAP)).toEqual(fillWithSize(AREA_4R, [], PASSPORT, GAP));
  });
});

describe('addOfSize', () => {
  it('places what fits and says how many did not', () => {
    // Two inches plus two inches is the sheet's full width; with margins only one fits across.
    const { placed, left, cells } = addOfSize(AREA_4R, [], TWO, 4, GAP);
    expect(placed).toBe(2);
    expect(left).toBe(2);
    expect(cells.map((cell) => cell.y)).toEqual([0, inches(2) + mm(2)]);
  });

  it('builds a combination: 2 × 2s first, then 1 × 1s in what is left', () => {
    const twos = addOfSize(AREA_4R, [], TWO, 2, { ...GAP, label: '2 × 2' });
    const mixed = fillWithSize(AREA_4R, twos.cells, ONE, { ...GAP, label: '1 × 1' });

    expect(mixed.cells.slice(0, 2)).toEqual(twos.cells);
    expect(mixed.placed).toBeGreaterThan(0);
    expect(checkCells(mixed.cells, AREA_4R)).toBeNull();
    // Beside the first 2 × 2, a 1 × 1 keeps the gap from it.
    expect(mixed.cells[2]).toEqual({ x: inches(2) + mm(2), y: 0, width: inches(1), height: inches(1), label: '1 × 1' });
  });

  it('keeps the gap from cells that were already there', () => {
    const existing: StudioCell[] = [{ x: 0, y: 0, width: inches(2), height: inches(2) }];
    const { cells } = addOfSize(AREA_4R, existing, ONE, 1, GAP);
    expect(cells[1]?.x).toBe(inches(2) + mm(2));
  });

  it('does not change the cells it was given', () => {
    const existing: StudioCell[] = [{ x: 0, y: 0, width: inches(1), height: inches(1) }];
    const copy = structuredClone(existing);
    addOfSize(AREA_4R, existing, ONE, 3, GAP);
    expect(existing).toEqual(copy);
  });
});

describe('splitIntoGrid', () => {
  it('divides the area into equal cells with the gap between them', () => {
    const cells = splitIntoGrid({ width: mm(100), height: mm(60) }, 2, 3, { gap: mm(2) });
    expect(cells).toHaveLength(6);
    expect(cells?.[0]).toEqual({ x: 0, y: 0, width: mm(32), height: mm(29) });
    expect(cells?.[5]).toEqual({ x: mm(68), y: mm(31), width: mm(32), height: mm(29) });
    expect(checkCells(cells ?? [], { width: mm(100), height: mm(60) })).toBeNull();
  });

  it('refuses a grid whose cells would be too small', () => {
    expect(splitIntoGrid({ width: mm(20), height: mm(20) }, 5, 5)).toBeNull();
    expect(splitIntoGrid({ width: mm(100), height: mm(100) }, 0, 2)).toBeNull();
  });
});

describe('moving and resizing by hand', () => {
  const area = { width: mm(100), height: mm(100) };
  const cells: StudioCell[] = [
    { x: 0, y: 0, width: mm(40), height: mm(40), label: '40' },
    { x: mm(50), y: 0, width: mm(40), height: mm(40) },
  ];

  it('stops a dragged cell at the edge of the area', () => {
    expect(moveCell(area, cells, 1, { x: mm(500), y: -mm(5) })).toEqual({
      cells: [cells[0], { ...cells[1], x: mm(60), y: 0 }],
    });
  });

  it('refuses a drag onto another cell and leaves the caller its cells', () => {
    expect(moveCell(area, cells, 1, { x: mm(20), y: 0 })).toEqual({ refused: 'cell_overlap' });
  });

  it('drops the size label when a cell is resized', () => {
    const result = resizeCell(area, cells, 0, { width: mm(45), height: mm(40) });
    expect(result).toEqual({ cells: [{ x: 0, y: 0, width: mm(45), height: mm(40) }, cells[1]] });
  });

  it('refuses a resize into a neighbour, and never goes below the smallest cell', () => {
    expect(resizeCell(area, cells, 0, { width: mm(60), height: mm(40) })).toEqual({ refused: 'cell_overlap' });
    expect(resizeCell(area, cells, 0, { width: 1, height: 1 })).toEqual({
      cells: [{ x: 0, y: 0, width: mm(5), height: mm(5) }, cells[1]],
    });
  });

  it('removes a cell', () => {
    expect(removeCell(cells, 0)).toEqual([cells[1]]);
  });

  it('snaps a dragged edge to a neighbour within reach, and not beyond it', () => {
    // One millimetre short of touching the first cell's right edge.
    expect(snapPosition(area, cells, 1, { x: mm(41), y: mm(1) })).toEqual({ x: mm(40), y: 0 });
    expect(snapPosition(area, cells, 1, { x: mm(45), y: mm(20) })).toEqual({ x: mm(45), y: mm(20) });
  });
});

describe('adding where the person points', () => {
  const area = { width: mm(100), height: mm(100) };

  it('centres the new cell on the point', () => {
    const { cells, placed } = addAt(area, [], { width: mm(20), height: mm(30) }, { x: mm(50), y: mm(50) }, 'Mine');
    expect(placed).toBe(1);
    expect(cells).toEqual([{ x: mm(40), y: mm(35), width: mm(20), height: mm(30), label: 'Mine' }]);
  });

  it('keeps it inside the area when dropped near an edge', () => {
    const { cells } = addAt(area, [], { width: mm(20), height: mm(20) }, { x: mm(99), y: -mm(5) });
    expect(cells[0]).toEqual({ x: mm(80), y: 0, width: mm(20), height: mm(20) });
  });

  it('goes to the first free place when the spot is taken, rather than doing nothing', () => {
    const taken: StudioCell[] = [{ x: 0, y: 0, width: mm(50), height: mm(50) }];
    const { cells, placed } = addAt(area, taken, { width: mm(20), height: mm(20) }, { x: mm(10), y: mm(10) });
    expect(placed).toBe(1);
    expect(cells[1]).toEqual({ x: mm(50), y: 0, width: mm(20), height: mm(20) });
    expect(checkCells(cells, area)).toBeNull();
  });

  it('places nothing larger than the area', () => {
    expect(addAt(area, [], { width: mm(200), height: mm(20) }, { x: 0, y: 0 }).placed).toBe(0);
  });
});

describe('adding a block of cells at once', () => {
  const area = { width: mm(100), height: mm(100) };
  const size = { width: mm(20), height: mm(10) };

  it('adds rows × columns of a size, the gap between them, as one block', () => {
    const { cells, placed, left } = addBlock(area, [], size, { rows: 2, columns: 3, gap: mm(2), label: 'x' });
    expect([placed, left]).toEqual([6, 0]);
    expect(cells[0]).toEqual({ x: 0, y: 0, width: mm(20), height: mm(10), label: 'x' });
    expect(cells[2]).toMatchObject({ x: mm(44), y: 0 });
    expect(cells[3]).toMatchObject({ x: 0, y: mm(12) });
    expect(checkCells(cells, area)).toBeNull();
  });

  it('centres the block on the point it was dropped at', () => {
    const { cells } = addBlock(area, [], size, { rows: 2, columns: 2, gap: 0, point: { x: mm(50), y: mm(50) } });
    expect(cells[0]).toMatchObject({ x: mm(30), y: mm(40) });
    expect(cells[3]).toMatchObject({ x: mm(50), y: mm(50) });
  });

  it('keeps the block together beside what is already there, with the gap', () => {
    const taken: StudioCell[] = [{ x: 0, y: 0, width: mm(50), height: mm(50) }];
    const { cells, placed } = addBlock(area, taken, size, { rows: 2, columns: 2, gap: mm(2) });
    expect(placed).toBe(4);
    expect(cells[1]).toMatchObject({ x: mm(52), y: 0 });
    expect(cells[4]).toMatchObject({ x: mm(74), y: mm(12) });
    expect(checkCells(cells, area)).toBeNull();
  });

  it('places the cells loose when the block cannot stay together, and says how many found no room', () => {
    // Six across is 120 mm: wider than the area. Loose, five fit in a row and the sixth starts the next.
    const wide = addBlock(area, [], size, { rows: 1, columns: 6 });
    expect([wide.placed, wide.left]).toEqual([6, 0]);
    expect(wide.cells[5]).toMatchObject({ x: 0, y: mm(10) });

    const tooMany = addBlock({ width: mm(40), height: mm(10) }, [], size, { rows: 1, columns: 3 });
    expect([tooMany.placed, tooMany.left]).toEqual([2, 1]);
  });

  it('treats a nonsense count as one', () => {
    expect(addBlock(area, [], size, { rows: 0, columns: -3 }).placed).toBe(1);
  });
});

describe('duplicating and turning a cell', () => {
  const area = { width: mm(100), height: mm(100) };
  const cells: StudioCell[] = [{ x: 0, y: 0, width: mm(35), height: mm(45), label: 'Passport' }];

  it('copies a cell, size and label, into the first free place', () => {
    const copy = duplicateCell(area, cells, 0);
    expect(copy.placed).toBe(1);
    expect(copy.cells[1]).toEqual({ x: mm(35), y: 0, width: mm(35), height: mm(45), label: 'Passport' });
  });

  it('turns a cell a quarter and keeps its label', () => {
    expect(rotateCell(area, cells, 0)).toEqual({
      cells: [{ x: 0, y: 0, width: mm(45), height: mm(35), label: 'Passport' }],
    });
  });

  it('pulls a turned cell back inside the area', () => {
    const edge: StudioCell[] = [{ x: mm(80), y: 0, width: mm(20), height: mm(60) }];
    expect(rotateCell(area, edge, 0)).toEqual({ cells: [{ x: mm(40), y: 0, width: mm(60), height: mm(20) }] });
  });

  it('refuses a turn onto a neighbour', () => {
    const pair: StudioCell[] = [
      { x: 0, y: 0, width: mm(20), height: mm(60) },
      { x: mm(25), y: 0, width: mm(20), height: mm(20) },
    ];
    expect(rotateCell(area, pair, 0)).toEqual({ refused: 'cell_overlap' });
  });
});

describe('readingOrder', () => {
  it('reads top row first, left to right, however the cells were drawn', () => {
    const drawn = [
      { x: mm(50), y: mm(50), width: 1, height: 1 },
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 0, y: mm(50), width: 1, height: 1 },
      { x: mm(50), y: 0, width: 1, height: 1 },
    ];
    expect(readingOrder(drawn)).toEqual([1, 3, 2, 0]);
  });
});
