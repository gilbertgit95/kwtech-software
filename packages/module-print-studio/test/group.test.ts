import { copyGroup, groupBounds, isEmptyGroup, moveGroup, removeGroup } from '../src/domain/group.js';
import type { StudioCell } from '../src/domain/layout.js';
import { newText, type StudioText } from '../src/domain/texts.js';
import { mm } from '../src/domain/units.js';

/** Everything here is in millimetres, and a printable area of 100 × 100. */
const AREA = { width: mm(100), height: mm(100) };

/** Every text is 20 × 5 mm here: the real measure needs a browser's fonts. */
const measure = () => ({ width: mm(20), height: mm(5) });

function cell(x: number, y: number, size = 10): StudioCell {
  return { x: mm(x), y: mm(y), width: mm(size), height: mm(size) };
}

function text(id: string, x: number, y: number): StudioText {
  return { ...newText(id), text: 'Name', x: mm(x), y: mm(y) };
}

/** Where a text is, in millimetres. */
function at(one: StudioText | undefined): [number, number] {
  return [(one?.x ?? Number.NaN) / mm(1), (one?.y ?? Number.NaN) / mm(1)];
}

const LAYOUT = {
  cells: [cell(0, 0), cell(50, 50)],
  texts: [text('a', 0, 12), text('b', 70, 0)],
};

describe('a group of cells and texts', () => {
  it('is bounded by its cells and its texts together', () => {
    expect(groupBounds(LAYOUT, { cells: [0], texts: ['a'] }, measure)).toEqual({
      x: 0,
      y: 0,
      width: mm(20),
      height: mm(17),
    });
    expect(groupBounds(LAYOUT, { cells: [], texts: [] }, measure)).toBeNull();
    expect(isEmptyGroup({ cells: [], texts: [] })).toBe(true);
  });

  it('moves as one: every cell and text the same distance', () => {
    const moved = moveGroup(AREA, LAYOUT, { cells: [0], texts: ['a'] }, { x: mm(5), y: mm(3) }, measure);
    expect('refused' in moved).toBe(false);
    if ('refused' in moved) return;
    expect(moved.cells[0]).toEqual(cell(5, 3));
    expect(at(moved.texts.find((one) => one.id === 'a'))).toEqual([5, 15]);
    // What is not in the group stays.
    expect(moved.cells[1]).toEqual(cell(50, 50));
    expect(at(moved.texts.find((one) => one.id === 'b'))).toEqual([70, 0]);
  });

  it('⚠ stops at the edge as a whole, so its shape never changes', () => {
    const moved = moveGroup(AREA, LAYOUT, { cells: [0], texts: ['b'] }, { x: mm(50), y: 0 }, measure);
    if ('refused' in moved) throw new Error('refused');
    // Text b is already 10 from the right edge: the whole group goes 10, not 50.
    expect(moved.cells[0]).toEqual(cell(10, 0));
    expect(at(moved.texts.find((one) => one.id === 'b'))).toEqual([80, 0]);
  });

  it('is refused whole when a cell would land on one that stays', () => {
    const moved = moveGroup(AREA, LAYOUT, { cells: [0], texts: ['a'] }, { x: mm(45), y: mm(45) }, measure);
    expect(moved).toEqual({ refused: 'cell_overlap' });
  });

  it('moves texts alone', () => {
    const moved = moveGroup(AREA, LAYOUT, { cells: [], texts: ['a', 'b'] }, { x: 0, y: mm(10) }, measure);
    if ('refused' in moved) throw new Error('refused');
    expect(moved.texts.map(at)).toEqual([
      [0, 22],
      [70, 10],
    ]);
    expect(moved.cells).toEqual(LAYOUT.cells);
  });

  it('removes its cells and its texts', () => {
    const left = removeGroup(LAYOUT, { cells: [0], texts: ['b'] });
    expect(left.cells).toEqual([cell(50, 50)]);
    expect(left.texts.map((one) => one.id)).toEqual(['a']);
  });
});

describe('copying a group', () => {
  let ids = 0;
  const newId = () => {
    ids += 1;
    return `copy-${ids}`;
  };

  it('puts the cells beside it and the texts the same distance away, as the selection', () => {
    const copy = copyGroup(AREA, LAYOUT, { cells: [0], texts: ['a'] }, { measure, newId });
    expect(copy.cells).toHaveLength(3);
    const added = copy.cells[copy.added.cells[0] ?? -1];
    expect(added).toBeDefined();
    // The cell went somewhere; the text went the same distance from where it was.
    const copiedText = copy.texts.find((one) => one.id === copy.added.texts[0]);
    expect(copiedText).toMatchObject({ x: added?.x ?? Number.NaN, y: (added?.y ?? Number.NaN) + mm(12), text: 'Name' });
    expect(copy.added.texts).toHaveLength(1);
  });

  it('puts texts alone under the group', () => {
    const copy = copyGroup(AREA, LAYOUT, { cells: [], texts: ['a'] }, { measure, newId });
    const copied = copy.texts.find((one) => one.id === copy.added.texts[0]);
    expect(at(copied)).toEqual([0, 17]);
    expect(copy.beside).toBe(true);
  });

  it('⚠ copies nothing when the cells have no room', () => {
    const full = { cells: [cell(0, 0, 100)], texts: [text('a', 0, 0)] };
    const copy = copyGroup(AREA, full, { cells: [0], texts: ['a'] }, { measure, newId });
    expect(isEmptyGroup(copy.added)).toBe(true);
    expect([copy.cells, copy.texts]).toEqual([full.cells, full.texts]);
  });
});
