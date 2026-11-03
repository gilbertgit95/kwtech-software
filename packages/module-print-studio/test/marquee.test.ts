import { cellsInRect, clampToSheet, rectBetween, rectContains } from '../src/domain/marquee.js';
import {
  createCoverTracker,
  edgeScrollStep,
  MARQUEE_EDGE_PX,
  MARQUEE_SCROLL_MAX_PX,
  marqueeIndexes,
  marqueeSelection,
  marqueeStart,
  sameIndexes,
  toggleIndex,
} from '../src/react/view/marquee.js';

/** Six cells, two rows of three, 100 square with 10 between them, starting at (10, 10). */
const CELLS = [0, 1].flatMap((row) =>
  [0, 1, 2].map((column) => ({ x: 10 + column * 110, y: 10 + row * 110, width: 100, height: 100 })),
);

describe('the rectangle between two points', () => {
  it('is the same whichever way it was drawn', () => {
    const expected = { x: 20, y: 30, width: 80, height: 50 };
    expect(rectBetween({ x: 20, y: 30 }, { x: 100, y: 80 })).toEqual(expected);
    expect(rectBetween({ x: 100, y: 80 }, { x: 20, y: 30 })).toEqual(expected);
    expect(rectBetween({ x: 100, y: 30 }, { x: 20, y: 80 })).toEqual(expected);
    expect(rectBetween({ x: 20, y: 80 }, { x: 100, y: 30 })).toEqual(expected);
  });

  it('is held to the sheet when the pointer leaves it', () => {
    const sheet = { width: 300, height: 200 };
    expect(clampToSheet({ x: -40, y: 250 }, sheet)).toEqual({ x: 0, y: 200 });
    expect(clampToSheet({ x: 120, y: 80 }, sheet)).toEqual({ x: 120, y: 80 });
  });
});

describe('the cells a rectangle selects', () => {
  it('takes every cell it overlaps any part of — six, across both rows', () => {
    expect(cellsInRect(rectBetween({ x: 0, y: 0 }, { x: 320, y: 220 }), CELLS)).toEqual([0, 1, 2, 3, 4, 5]);
    // Only a corner of cells 0, 1, 3 and 4.
    expect(cellsInRect(rectBetween({ x: 105, y: 105 }, { x: 125, y: 125 }), CELLS)).toEqual([0, 1, 3, 4]);
  });

  it('takes the same cells drawn in any direction', () => {
    const forward = cellsInRect(rectBetween({ x: 50, y: 50 }, { x: 200, y: 60 }), CELLS);
    expect(forward).toEqual([0, 1]);
    expect(cellsInRect(rectBetween({ x: 200, y: 60 }, { x: 50, y: 50 }), CELLS)).toEqual(forward);
  });

  it('takes nothing drawn in a gap, or touching an edge only', () => {
    expect(cellsInRect(rectBetween({ x: 111, y: 0 }, { x: 119, y: 220 }), CELLS)).toEqual([]);
    // Its right edge exactly on cell 1's left edge.
    expect(cellsInRect(rectBetween({ x: 111, y: 20 }, { x: 120, y: 30 }), CELLS)).toEqual([]);
    expect(cellsInRect(rectBetween({ x: 0, y: 0 }, { x: 5, y: 5 }), [])).toEqual([]);
  });

  it('crosses cells with a drag straight across, which has no height', () => {
    expect(cellsInRect(rectBetween({ x: 0, y: 50 }, { x: 330, y: 50 }), CELLS)).toEqual([0, 1, 2]);
  });

  it('with "inside", takes only the cells wholly within it, edges included', () => {
    const rect = rectBetween({ x: 10, y: 10 }, { x: 240, y: 125 });
    expect(cellsInRect(rect, CELLS, 'inside')).toEqual([0, 1]);
    expect(cellsInRect(rect, CELLS, 'overlap')).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rectContains(rect, { x: 10, y: 10, width: 100, height: 100 })).toBe(true);
  });
});

describe('where a rectangle may start', () => {
  it('a mouse or pen starts one on the paper or an empty cell at once', () => {
    expect(marqueeStart('paper', 'mouse', false)).toBe('now');
    expect(marqueeStart('empty_cell', 'pen', false)).toBe('now');
  });

  it('never on a photo, whose drag moves it — unless Alt is held', () => {
    expect(marqueeStart('filled_cell', 'mouse', false)).toBe('none');
    expect(marqueeStart('filled_cell', 'mouse', true)).toBe('now');
  });

  it('a finger only after resting, so a one-finger drag still scrolls', () => {
    expect(marqueeStart('paper', 'touch', false)).toBe('hold');
    expect(marqueeStart('filled_cell', 'touch', false)).toBe('none');
  });
});

describe('the selection while a rectangle is drawn', () => {
  const base = [
    { page: 1, cell: 4 },
    { page: 0, cell: 2 },
  ];

  it('replaces the selection, on every page, with what it covers', () => {
    expect(marqueeSelection(base, 0, [0, 1], false)).toEqual([
      { page: 0, cell: 0 },
      { page: 0, cell: 1 },
    ]);
    expect(marqueeSelection(base, 0, [], false)).toEqual([]);
  });

  it('adding, keeps what was selected and adds each covered cell once', () => {
    expect(marqueeSelection(base, 0, [1, 2], true)).toEqual([...base, { page: 0, cell: 1 }]);
    // A cell passed over and left again drops back out: it is always from the base, never from the last step.
    expect(marqueeSelection(base, 0, [], true)).toEqual(base);
  });

  it('compares the covered cells, so an unchanged cover re-renders nothing', () => {
    expect(sameIndexes([0, 1], [0, 1])).toBe(true);
    expect(sameIndexes([0, 1], [0, 2])).toBe(false);
    expect(sameIndexes([], [0])).toBe(false);
  });
});

describe('scrolling at the edge of the view', () => {
  const box = { left: 100, top: 100, right: 500, bottom: 400 };

  it('stands still in the middle', () => {
    expect(edgeScrollStep({ x: 300, y: 250 }, box)).toEqual({ dx: 0, dy: 0 });
  });

  it('scrolls toward the edge the pointer is near, faster the nearer', () => {
    const near = edgeScrollStep({ x: 300, y: box.bottom - MARQUEE_EDGE_PX / 2 }, box);
    const nearer = edgeScrollStep({ x: 300, y: box.bottom - 2 }, box);
    expect(near.dx).toBe(0);
    expect(near.dy).toBeGreaterThan(0);
    expect(nearer.dy).toBeGreaterThan(near.dy);
    expect(edgeScrollStep({ x: box.left + 4, y: 250 }, box).dx).toBeLessThan(0);
  });

  it('at full speed, and no faster, past the edge', () => {
    expect(edgeScrollStep({ x: box.right + 200, y: box.top - 200 }, box)).toEqual({
      dx: MARQUEE_SCROLL_MAX_PX,
      dy: -MARQUEE_SCROLL_MAX_PX,
    });
  });
});

describe('the editor’s selection by rectangle', () => {
  it('replaces the selection with the covered cells, or adds them once', () => {
    expect(marqueeIndexes([4, 2], [0, 1], false)).toEqual([0, 1]);
    expect(marqueeIndexes([4, 2], [2, 3], true)).toEqual([4, 2, 3]);
    expect(marqueeIndexes([4, 2], [], true)).toEqual([4, 2]);
  });

  it('a Ctrl-click adds a cell last, or takes it out', () => {
    expect(toggleIndex([1, 3], 5)).toEqual([1, 3, 5]);
    expect(toggleIndex([1, 3, 5], 3)).toEqual([1, 5]);
  });
});

describe('reporting what a rectangle covers', () => {
  it('a new press reports its first cover even when it is nothing, so a rectangle over bare paper clears', () => {
    // ⚠ Through the same tracker the hook makes for every press: a tracker that started from "an empty cover"
    // would answer false here, and the old selection would stay (CodeRabbit on #54).
    expect(createCoverTracker().report([])).toBe(true);
    expect(createCoverTracker().report([2])).toBe(true);
  });

  it('after that, reports only a change', () => {
    const tracker = createCoverTracker();
    expect(tracker.report([])).toBe(true);
    expect(tracker.report([])).toBe(false);
    expect(tracker.report([1, 2])).toBe(true);
    expect(tracker.report([1, 2])).toBe(false);
    expect(tracker.report([1])).toBe(true);
    expect(tracker.report([])).toBe(true);
  });

  it('remembers a copy, so a caller changing its list afterwards changes nothing', () => {
    const tracker = createCoverTracker();
    const cells = [1, 2];
    tracker.report(cells);
    cells.push(3);
    expect(tracker.report([1, 2])).toBe(false);
  });
});
