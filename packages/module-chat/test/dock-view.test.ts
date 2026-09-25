import {
  clampDock,
  DEFAULT_DOCK_POSITION,
  DOCK_EDGE_PX,
  draggedDock,
  parseStoredDock,
} from '../src/react/view/dock-view.js';

const size = { width: 360, height: 500 };
const viewport = { width: 1280, height: 800 };

describe('clampDock', () => {
  it('leaves a position that fits alone', () => {
    expect(clampDock(DEFAULT_DOCK_POSITION, size, viewport)).toEqual(DEFAULT_DOCK_POSITION);
  });

  it('⚠ keeps the title bar on screen, so the window can always be grabbed again', () => {
    // Dragged far up: bottom is capped so the top edge stays inside.
    expect(clampDock({ right: 16, bottom: 5000 }, size, viewport).bottom).toBe(800 - 500 - DOCK_EDGE_PX);
    // Dragged far left.
    expect(clampDock({ right: 5000, bottom: 16 }, size, viewport).right).toBe(1280 - 360 - DOCK_EDGE_PX);
  });

  it('keeps it off the right and bottom edges too', () => {
    expect(clampDock({ right: -40, bottom: -40 }, size, viewport)).toEqual({
      right: DOCK_EDGE_PX,
      bottom: DOCK_EDGE_PX,
    });
  });

  it('pins to the corner when the viewport is smaller than the window', () => {
    expect(clampDock({ right: 100, bottom: 100 }, size, { width: 320, height: 400 })).toEqual({
      right: DOCK_EDGE_PX,
      bottom: DOCK_EDGE_PX,
    });
  });
});

describe('draggedDock', () => {
  it('moves away from the corner as the pointer moves left and up', () => {
    expect(draggedDock({ right: 16, bottom: 16 }, { x: 500, y: 500 }, { x: 400, y: 450 })).toEqual({
      right: 116,
      bottom: 66,
    });
  });
});

describe('parseStoredDock', () => {
  it('reads back what the window stores', () => {
    const stored = { position: { right: 40, bottom: 60 }, collapsed: true, conversationId: 'c1' };
    expect(parseStoredDock(JSON.stringify(stored))).toEqual(stored);
  });

  it('treats anything else as nothing stored', () => {
    expect(parseStoredDock(null)).toBeNull();
    expect(parseStoredDock('not json')).toBeNull();
    expect(parseStoredDock(JSON.stringify({ position: { right: 'x', bottom: 1 } }))).toBeNull();
    expect(parseStoredDock(JSON.stringify({ collapsed: true }))).toBeNull();
  });

  it('defaults the optional parts rather than refusing the position', () => {
    expect(parseStoredDock(JSON.stringify({ position: { right: 1, bottom: 2 }, conversationId: '' }))).toEqual({
      position: { right: 1, bottom: 2 },
      collapsed: false,
      conversationId: null,
    });
  });
});
