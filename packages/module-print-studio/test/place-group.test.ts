import type { StudioCell } from '../src/domain/layout.js';
import {
  boundsOf,
  duplicateCell,
  duplicateCells,
  moveCell,
  moveCells,
  removeCells,
  resizeCell,
  resizeCells,
  rotateCell,
  rotateCells,
  snapGroupPosition,
  snapPosition,
} from '../src/domain/place.js';

/** A 10000 × 6000 area: a row of two 1000-square cells at the top left, and one far away at the bottom right. */
const AREA = { width: 10000, height: 6000 };
const CELLS: StudioCell[] = [
  { x: 0, y: 0, width: 1000, height: 1000, label: '2 × 2' },
  { x: 1000, y: 0, width: 1000, height: 1000, label: '2 × 2' },
  { x: 8000, y: 4000, width: 1000, height: 1000 },
];

function cellsOf(result: { cells: StudioCell[] } | { refused: string }): StudioCell[] {
  if (!('cells' in result)) throw new Error(`refused: ${result.refused}`);
  return result.cells;
}

describe('the bounding box of a selection', () => {
  it('surrounds the cells chosen, and is null for none', () => {
    expect(boundsOf(CELLS, [0, 1])).toEqual({ x: 0, y: 0, width: 2000, height: 1000 });
    expect(boundsOf(CELLS, [1, 2])).toEqual({ x: 1000, y: 0, width: 8000, height: 5000 });
    expect(boundsOf(CELLS, [])).toBeNull();
    expect(boundsOf(CELLS, [9])).toBeNull();
  });
});

describe('moving several cells', () => {
  it('moves every one by the same distance, keeping the group’s shape', () => {
    const moved = cellsOf(moveCells(AREA, CELLS, [0, 1], { x: 3000, y: 1500 }));
    expect(moved.slice(0, 2).map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 3000, y: 1500 },
      { x: 4000, y: 1500 },
    ]);
    expect(moved[2]).toEqual(CELLS[2]);
  });

  it('stops the group as one at the edge, rather than folding it up', () => {
    const moved = cellsOf(moveCells(AREA, CELLS, [0, 1], { x: 50000, y: -500 }));
    expect(moved.slice(0, 2).map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 8000, y: 0 },
      { x: 9000, y: 0 },
    ]);
  });

  it('refuses all of it when one would land on a cell outside the group', () => {
    expect(moveCells(AREA, CELLS, [0, 1], { x: 7500, y: 3800 })).toEqual({ refused: 'cell_overlap' });
  });

  it('moves the cells of the group past each other’s old places', () => {
    // Cell 0 moves onto where cell 1 was: allowed, cell 1 moved too.
    const moved = cellsOf(moveCells(AREA, CELLS, [0, 1], { x: 1000, y: 0 }));
    expect(moved[0]?.x).toBe(1000);
    expect(moved[1]?.x).toBe(2000);
  });

  it('with one cell, is exactly moveCell', () => {
    expect(moveCells(AREA, CELLS, [2], { x: 400, y: 3000 })).toEqual(moveCell(AREA, CELLS, 2, { x: 400, y: 3000 }));
  });

  it('snaps the group’s edges to the cells that stay, not to its own', () => {
    // The group's right edge (at 2000 + x) comes within reach of cell 2's left edge (8000).
    expect(snapGroupPosition(AREA, CELLS, [0, 1], { x: 5950, y: 2500 }, 100)).toEqual({ x: 6000, y: 2500 });
    expect(snapGroupPosition(AREA, CELLS, [2], { x: 7950, y: 2500 }, 100)).toEqual(
      snapPosition(AREA, CELLS, 2, { x: 7950, y: 2500 }, 100),
    );
  });
});

describe('resizing several cells', () => {
  it('changes only the side asked for, each from its own top left', () => {
    const resized = cellsOf(resizeCells(AREA, CELLS, [0, 2], { height: 1500 }));
    expect(resized[0]).toEqual({ x: 0, y: 0, width: 1000, height: 1500 });
    expect(resized[2]).toEqual({ x: 8000, y: 4000, width: 1000, height: 1500 });
    expect(resized[1]).toEqual(CELLS[1]);
  });

  it('refuses when the cells would then overlap each other', () => {
    expect(resizeCells(AREA, CELLS, [0, 1], { width: 1500 })).toEqual({ refused: 'cell_overlap' });
  });

  it('with one cell, is exactly resizeCell', () => {
    const size = { width: 2500, height: 900 };
    expect(resizeCells(AREA, CELLS, [2], size)).toEqual(resizeCell(AREA, CELLS, 2, size));
  });
});

describe('turning several cells', () => {
  it('turns each about its own top left, or refuses all of them', () => {
    const wide: StudioCell[] = [
      { x: 0, y: 0, width: 2000, height: 1000 },
      { x: 3000, y: 0, width: 2000, height: 1000 },
    ];
    const turned = cellsOf(rotateCells(AREA, wide, [0, 1]));
    expect(turned.map(({ width, height }) => ({ width, height }))).toEqual([
      { width: 1000, height: 2000 },
      { width: 1000, height: 2000 },
    ]);
    // Turned, the first would cover the second's top left.
    const close: StudioCell[] = [
      { x: 0, y: 0, width: 1000, height: 3000 },
      { x: 1500, y: 0, width: 1000, height: 1000 },
    ];
    expect(rotateCells(AREA, close, [0, 1])).toEqual({ refused: 'cell_overlap' });
  });

  it('with one cell, is exactly rotateCell', () => {
    expect(rotateCells(AREA, CELLS, [2])).toEqual(rotateCell(AREA, CELLS, 2));
  });
});

describe('copying several cells', () => {
  it('copies the group beside itself, keeping its shape, and names the copies', () => {
    const copy = duplicateCells(AREA, CELLS, [0, 1]);
    expect(copy.beside).toBe(true);
    expect(copy.added).toEqual([3, 4]);
    expect(copy.cells.slice(3)).toEqual([
      { x: 2000, y: 0, width: 1000, height: 1000, label: '2 × 2' },
      { x: 3000, y: 0, width: 1000, height: 1000, label: '2 × 2' },
    ]);
  });

  it('goes to the first free place its bounding box fits when there is no room beside', () => {
    const copy = duplicateCells(AREA, CELLS, [0, 1], { x: 7000, y: 0 });
    expect(copy.beside).toBe(false);
    expect(copy.placed).toBe(2);
    expect(copy.cells.slice(3).map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 2000, y: 0 },
      { x: 3000, y: 0 },
    ]);
  });

  it('places nothing when the group fits nowhere whole', () => {
    const full: StudioCell[] = [
      { x: 0, y: 0, width: 6000, height: 6000 },
      { x: 6000, y: 0, width: 4000, height: 6000 },
    ];
    const copy = duplicateCells(AREA, full, [0]);
    expect(copy.placed).toBe(0);
    expect(copy.cells).toEqual(full);
  });

  it('with one cell, places it where duplicateCell does', () => {
    const offset = { x: 100, y: 200 };
    expect(duplicateCells(AREA, CELLS, [1], offset).cells).toEqual(duplicateCell(AREA, CELLS, 1, offset).cells);
  });
});

describe('removing several cells', () => {
  it('takes out every one chosen, and keeps the rest in order', () => {
    expect(removeCells(CELLS, [0, 2])).toEqual([CELLS[1]]);
    expect(removeCells(CELLS, [])).toEqual(CELLS);
  });
});
