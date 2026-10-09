import { POPOVER_EDGE_PX, POPOVER_GAP_PX, popoverPlacement } from '../src/react/view/popover.js';

const VIEWPORT = { width: 1000, height: 800 };

describe('popoverPlacement', () => {
  it('opens below the trigger, lined up with its left edge, when it fits', () => {
    const placed = popoverPlacement(
      { left: 100, top: 100, width: 200, height: 36 },
      { width: 200, height: 300 },
      VIEWPORT,
      'start',
    );
    expect(placed).toEqual({
      left: 100,
      top: 136 + POPOVER_GAP_PX,
      maxHeight: 800 - 136 - POPOVER_GAP_PX - POPOVER_EDGE_PX,
    });
  });

  it('flips above a trigger at the bottom of the screen', () => {
    const placed = popoverPlacement(
      { left: 100, top: 700, width: 200, height: 36 },
      { width: 200, height: 300 },
      VIEWPORT,
      'start',
    );
    expect(placed.top).toBe(700 - POPOVER_GAP_PX - 300);
    expect(placed.maxHeight).toBe(700 - POPOVER_GAP_PX - POPOVER_EDGE_PX);
  });

  it('stays below when neither side fits but below has more room, and says how tall it may be', () => {
    const placed = popoverPlacement(
      { left: 100, top: 200, width: 200, height: 36 },
      { width: 200, height: 900 },
      VIEWPORT,
      'start',
    );
    expect(placed.top).toBe(236 + POPOVER_GAP_PX);
    expect(placed.maxHeight).toBe(800 - 236 - POPOVER_GAP_PX - POPOVER_EDGE_PX);
  });

  it('never leaves the top of the screen when it opens above and is taller than the room there', () => {
    const placed = popoverPlacement(
      { left: 100, top: 500, width: 200, height: 280 },
      { width: 200, height: 900 },
      VIEWPORT,
      'start',
    );
    expect(placed.top).toBe(POPOVER_EDGE_PX);
    expect(placed.maxHeight).toBe(500 - POPOVER_GAP_PX - POPOVER_EDGE_PX);
  });

  it('lines its right edge up with the trigger when aligned to the end', () => {
    const placed = popoverPlacement(
      { left: 600, top: 100, width: 100, height: 36 },
      { width: 280, height: 300 },
      VIEWPORT,
      'end',
    );
    expect(placed.left).toBe(700 - 280);
  });

  it('is held inside the screen at both edges', () => {
    const size = { width: 280, height: 300 };
    const right = popoverPlacement({ left: 900, top: 100, width: 90, height: 36 }, size, VIEWPORT, 'start');
    expect(right.left).toBe(1000 - 280 - POPOVER_EDGE_PX);
    const left = popoverPlacement({ left: 10, top: 100, width: 90, height: 36 }, size, VIEWPORT, 'end');
    expect(left.left).toBe(POPOVER_EDGE_PX);
  });

  it('keeps its start on screen when it is wider than the screen', () => {
    const placed = popoverPlacement(
      { left: 20, top: 100, width: 90, height: 36 },
      { width: 400, height: 300 },
      { width: 320, height: 800 },
      'start',
    );
    expect(placed.left).toBe(POPOVER_EDGE_PX);
  });
});
