import { borderSegments } from '../src/domain/border.js';

const cell = (x: number, y: number, width = 10, height = 10) => ({ x, y, width, height });

describe('borderSegments', () => {
  it('draws the four sides of one cell', () => {
    expect(borderSegments([cell(0, 0)])).toEqual([
      { x1: 0, y1: 0, x2: 10, y2: 0 },
      { x1: 0, y1: 10, x2: 10, y2: 10 },
      { x1: 0, y1: 0, x2: 0, y2: 10 },
      { x1: 10, y1: 0, x2: 10, y2: 10 },
    ]);
  });

  it('⚠ draws the edge two touching cells share ONCE — or a dashed line prints solid', () => {
    const segments = borderSegments([cell(0, 0), cell(10, 0)]);
    const shared = segments.filter((one) => one.x1 === 10 && one.x2 === 10);
    expect(shared).toEqual([{ x1: 10, y1: 0, x2: 10, y2: 10 }]);
  });

  it('joins the tops of a row of cells into one line, with one run of dashes', () => {
    const row = [cell(0, 0), cell(10, 0), cell(20, 0)];
    const tops = borderSegments(row).filter((one) => one.y1 === 0 && one.y2 === 0);
    expect(tops).toEqual([{ x1: 0, y1: 0, x2: 30, y2: 0 }]);
    // Six lines in all: top, bottom, and the four uprights — not twelve.
    expect(borderSegments(row)).toHaveLength(6);
  });

  it('keeps apart cells with a gap between them', () => {
    const tops = borderSegments([cell(0, 0), cell(12, 0)]).filter((one) => one.y1 === 0 && one.y2 === 0);
    expect(tops).toEqual([
      { x1: 0, y1: 0, x2: 10, y2: 0 },
      { x1: 12, y1: 0, x2: 22, y2: 0 },
    ]);
  });

  it('joins only the part two cells of different sizes share', () => {
    // A 20-tall cell beside a 10-tall one: one upright from 0 to 20 at x = 20.
    const uprights = borderSegments([cell(0, 0, 20, 20), cell(20, 0, 10, 10)]).filter(
      (one) => one.x1 === 20 && one.x2 === 20,
    );
    expect(uprights).toEqual([{ x1: 20, y1: 0, x2: 20, y2: 20 }]);
  });

  it('draws nothing for nothing, and skips a cell with no size', () => {
    expect(borderSegments([])).toEqual([]);
    expect(borderSegments([cell(0, 0, 0, 10)])).toEqual([]);
  });

  it('is the same every time, whatever order the cells were drawn in', () => {
    const cells = [cell(10, 10), cell(0, 0), cell(10, 0), cell(0, 10)];
    expect(borderSegments(cells)).toEqual(borderSegments([...cells].reverse()));
  });
});
