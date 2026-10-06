import {
  clampCrop,
  clampFrame,
  DEFAULT_FRAME,
  effectiveDpi,
  freeRect,
  keepInCell,
  nextRotation,
  panFrame,
  resetFrame,
  STUDIO_FREE_ZOOM_MIN,
  type StudioFrame,
  type StudioRotation,
  setFreePlacement,
  sourceRect,
  zoomFrameBy,
} from '../src/domain/slot-fit.js';
import { inches } from '../src/domain/units.js';

const SQUARE = { width: inches(2), height: inches(2) };
/** A landscape phone photo. */
const WIDE = { width: 4000, height: 3000 };

describe('sourceRect', () => {
  it('covers a square cell with the centre of a wide photo', () => {
    expect(sourceRect(WIDE, SQUARE, DEFAULT_FRAME)).toEqual({ x: 500, y: 0, width: 3000, height: 3000 });
  });

  it('moves through the slack: −1 keeps the left edge, 1 the right', () => {
    expect(sourceRect(WIDE, SQUARE, { ...DEFAULT_FRAME, offsetX: -1 }).x).toBe(0);
    expect(sourceRect(WIDE, SQUARE, { ...DEFAULT_FRAME, offsetX: 1 }).x).toBe(1000);
    // No slack down a wide photo in a square cell: the offset changes nothing.
    expect(sourceRect(WIDE, SQUARE, { ...DEFAULT_FRAME, offsetY: 1 }).y).toBe(0);
  });

  it('zooms about the centre and keeps the cell’s shape', () => {
    const zoomed = sourceRect(WIDE, SQUARE, { ...DEFAULT_FRAME, zoom: 2 });
    expect(zoomed).toEqual({ x: 1250, y: 750, width: 1500, height: 1500 });
  });

  it('never zooms out past filling the cell', () => {
    expect(sourceRect(WIDE, SQUARE, { ...DEFAULT_FRAME, zoom: 0.5 })).toEqual(sourceRect(WIDE, SQUARE, DEFAULT_FRAME));
  });

  it('takes a sideways slice for a quarter turn', () => {
    const tall = { width: inches(2), height: inches(3) };
    // Turned, the cell is 3 across and 2 down in the photo's own grid.
    const turned = sourceRect(WIDE, tall, { ...DEFAULT_FRAME, rotation: 90 });
    expect(turned.width / turned.height).toBeCloseTo(3 / 2, 6);
    expect(turned).toEqual({ x: 0, y: (3000 - 4000 / 1.5) / 2, width: 4000, height: 4000 / 1.5 });
  });

  it('moves left on the sheet whichever way the photo is turned', () => {
    const tall = { width: inches(2), height: inches(4) };
    // A quarter turn clockwise puts the photo's bottom edge on the sheet's left.
    const left = sourceRect(WIDE, tall, { ...DEFAULT_FRAME, rotation: 90, offsetX: -1 });
    const right = sourceRect(WIDE, tall, { ...DEFAULT_FRAME, rotation: 90, offsetX: 1 });
    expect(left.y).toBeGreaterThan(right.y);
  });

  it('works inside the photo’s crop', () => {
    const crop = { x: 0.5, y: 0, width: 0.5, height: 1 };
    // The right half is 2000 × 3000; a square from its centre.
    expect(sourceRect(WIDE, SQUARE, DEFAULT_FRAME, crop)).toEqual({ x: 2000, y: 500, width: 2000, height: 2000 });
  });
});

describe('panFrame', () => {
  it('follows the hand: dragged right, the cell looks further left in the photo', () => {
    // A 4000 × 3000 photo in a square cell shows 3000 of its width: a third of the cell of slack each way... 1000 px in all.
    const moved = panFrame(WIDE, SQUARE, DEFAULT_FRAME, { dx: 0.1, dy: 0 });
    expect(moved.offsetX).toBeCloseTo(-0.6, 6);
    expect(sourceRect(WIDE, SQUARE, moved).x).toBeCloseTo(200, 6);
    // The photo moved by a tenth of the cell: 300 of the 3000 source pixels it shows.
    expect(sourceRect(WIDE, SQUARE, DEFAULT_FRAME).x - sourceRect(WIDE, SQUARE, moved).x).toBeCloseTo(300, 6);
  });

  it('stops at the edge of the photo', () => {
    expect(panFrame(WIDE, SQUARE, DEFAULT_FRAME, { dx: 5, dy: 0 }).offsetX).toBe(-1);
    expect(panFrame(WIDE, SQUARE, DEFAULT_FRAME, { dx: -5, dy: 0 }).offsetX).toBe(1);
  });

  it('does not move along an axis with nothing more to show, until zoomed', () => {
    expect(panFrame(WIDE, SQUARE, DEFAULT_FRAME, { dx: 0, dy: 0.3 }).offsetY).toBe(0);
    const zoomed = { ...DEFAULT_FRAME, zoom: 2 };
    expect(panFrame(WIDE, SQUARE, zoomed, { dx: 0, dy: 0.25 }).offsetY).toBeCloseTo(-0.5, 6);
  });

  it('follows the hand when the photo is turned, and when it is mirrored', () => {
    const tall = { width: inches(2), height: inches(4) };
    const turned = { ...DEFAULT_FRAME, rotation: 90 as const };
    const right = panFrame(WIDE, tall, turned, { dx: 0.1, dy: 0 });
    expect(right.offsetX).toBeLessThan(0);
    const mirrored = panFrame(WIDE, SQUARE, DEFAULT_FRAME, { dx: 0.1, dy: 0 }, undefined, {
      horizontal: true,
      vertical: false,
    });
    expect(mirrored.offsetX).toBeCloseTo(0.6, 6);
  });
});

describe('effectiveDpi', () => {
  it('is the source pixels over the printed inches', () => {
    expect(effectiveDpi(WIDE, SQUARE, DEFAULT_FRAME)).toBeCloseTo(1500, 6);
    expect(effectiveDpi(WIDE, SQUARE, { ...DEFAULT_FRAME, zoom: 2 })).toBeCloseTo(750, 6);
  });

  it('falls below 150 for a small photo in a large cell', () => {
    const thumbnail = { width: 640, height: 480 };
    const eightByTen = { width: inches(8), height: inches(10) };
    expect(effectiveDpi(thumbnail, eightByTen, DEFAULT_FRAME)).toBeLessThan(150);
  });
});

describe('clamping', () => {
  it('keeps a frame inside what means something', () => {
    expect(clampFrame({ zoom: 99, offsetX: -5, offsetY: Number.NaN, rotation: 90 })).toEqual({
      zoom: 8,
      offsetX: -1,
      offsetY: -1,
      rotation: 90,
    });
  });

  it('keeps a crop inside the photo', () => {
    expect(clampCrop({ x: 0.8, y: -1, width: 0.5, height: 2 })).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
  });

  it('turns a quarter at a time, back to upright', () => {
    expect([0, 90, 180, 270].map((rotation) => nextRotation(rotation as 0 | 90 | 180 | 270))).toEqual([
      90, 180, 270, 0,
    ]);
  });
});

describe('free placement', () => {
  const FREE: StudioFrame = { ...DEFAULT_FRAME, free: true };
  const AT_ORIGIN = { x: 0, y: 0, ...SQUARE };

  it('at 100% and centred, draws the photo as large as covering does', () => {
    // A 4:3 photo covering a square: as tall as the cell, a third wider, overhanging both sides equally.
    const placed = freeRect(WIDE, AT_ORIGIN, FREE);
    expect(placed.height).toBeCloseTo(SQUARE.height, 6);
    expect(placed.width).toBeCloseTo((SQUARE.width * 4) / 3, 6);
    expect(placed.x + placed.width / 2).toBeCloseTo(SQUARE.width / 2, 6);
  });

  it('shrinks below the cell, about its centre, and moves by whole cells', () => {
    const half = freeRect(WIDE, AT_ORIGIN, { ...FREE, zoom: 0.5 });
    expect(half.height).toBeCloseTo(SQUARE.height / 2, 6);
    expect(half.y).toBeCloseTo(SQUARE.height / 4, 6);
    const moved = freeRect(WIDE, AT_ORIGIN, { ...FREE, zoom: 0.5, offsetX: 1.5, offsetY: -0.25 });
    expect(moved.x - half.x).toBeCloseTo(SQUARE.width * 1.5, 6);
    expect(moved.y - half.y).toBeCloseTo(-SQUARE.height * 0.25, 6);
  });

  it('lets the zoom go below 1 only when free, and centres a NaN offset', () => {
    expect(clampFrame({ ...FREE, zoom: 0.2 }).zoom).toBe(0.2);
    expect(clampFrame({ ...FREE, zoom: 0 }).zoom).toBe(STUDIO_FREE_ZOOM_MIN);
    expect(clampFrame({ ...DEFAULT_FRAME, zoom: 0.2 }).zoom).toBe(1);
    expect(clampFrame({ ...FREE, offsetX: Number.NaN, offsetY: 3 })).toMatchObject({ offsetX: 0, offsetY: 3 });
  });

  it('follows the hand past the photo’s own edge, on the sheet’s axes whatever the turn', () => {
    // Covering, a wide photo in a square cannot move up or down at all; free, it can.
    expect(panFrame(WIDE, SQUARE, FREE, { dx: 0, dy: 0.3 }).offsetY).toBeCloseTo(0.3, 6);
    const turned = { ...FREE, rotation: 90 as const };
    expect(
      panFrame(WIDE, SQUARE, turned, { dx: 2, dy: 0 }, undefined, { horizontal: true, vertical: false }),
    ).toMatchObject({ offsetX: 2, offsetY: 0 });
  });

  it('lets a free photo past the cell’s edge, but keeps half of it inside', () => {
    // At 50% the photo is smaller than the cell both ways: its centre may reach the cell's edge, no further.
    const far = keepInCell(WIDE, SQUARE, { ...FREE, zoom: 0.5, offsetX: 9, offsetY: -9 });
    expect(far.offsetX).toBeCloseTo(0.5, 6);
    expect(far.offsetY).toBeCloseTo(-0.5, 6);
    // At 300% it is larger: its own edge may come to the cell's middle, a cell and a half from centred across.
    expect(keepInCell(WIDE, SQUARE, { ...FREE, zoom: 3, offsetX: 9 }).offsetX).toBeCloseTo(2, 6);
    const covering = { ...DEFAULT_FRAME, offsetX: -1 };
    expect(keepInCell(WIDE, SQUARE, covering)).toBe(covering);
  });

  it('turns on without the photo jumping: a photo kept to its right edge stays there', () => {
    const right = setFreePlacement(WIDE, SQUARE, { ...DEFAULT_FRAME, offsetX: 1 }, true);
    expect(right.free).toBe(true);
    const placed = freeRect(WIDE, AT_ORIGIN, right);
    expect(placed.x + placed.width).toBeCloseTo(SQUARE.width, 6);
  });

  it('turns on without jumping when turned too: the photo’s top, at the cell’s right, stays there', () => {
    const tall = { width: inches(2), height: inches(3) };
    // Turned a quarter clockwise, the photo's top is on the right; kept to the right edge, its top meets the cell's.
    const right = setFreePlacement(WIDE, tall, { ...DEFAULT_FRAME, rotation: 90, offsetX: 1 }, true);
    const placed = freeRect(WIDE, { x: 0, y: 0, ...tall }, right);
    expect(placed.x + placed.width).toBeCloseTo(tall.width, 6);
    expect(placed.y).toBeCloseTo(0, 6);
    expect(placed.height).toBeCloseTo(tall.height, 6);
  });

  it('goes there and back to the same covering frame, turned and mirrored', () => {
    const tall = { width: inches(2), height: inches(3) };
    for (const rotation of [0, 90, 180, 270] as StudioRotation[]) {
      for (const flip of [
        { horizontal: false, vertical: false },
        { horizontal: true, vertical: false },
        { horizontal: true, vertical: true },
      ]) {
        const start = { zoom: 1.6, offsetX: 0.4, offsetY: -0.7, rotation };
        const free = setFreePlacement(WIDE, tall, start, true, undefined, flip);
        const back = setFreePlacement(WIDE, tall, free, false, undefined, flip);
        expect(back.free).toBeUndefined();
        expect(back.zoom).toBeCloseTo(start.zoom, 6);
        expect(back.offsetX).toBeCloseTo(start.offsetX, 6);
        expect(back.offsetY).toBeCloseTo(start.offsetY, 6);
      }
    }
  });

  it('turned off, a photo shrunk below its cell grows back to fill it', () => {
    const back = setFreePlacement(WIDE, SQUARE, { ...FREE, zoom: 0.3, offsetX: 4 }, false);
    expect(back.zoom).toBe(1);
    // Moved far right, it stops at the edge of its slack the same way.
    expect(back.offsetX).toBe(-1);
  });

  it('prints coarser as it is enlarged and finer as it is shrunk', () => {
    expect(effectiveDpi(WIDE, SQUARE, { ...FREE, zoom: 0.5 })).toBeCloseTo(3000, 6);
  });

  it('zooms by steps down to the free floor, and resets without losing the switch', () => {
    expect(zoomFrameBy(DEFAULT_FRAME, -0.1).zoom).toBe(1);
    expect(zoomFrameBy({ ...FREE, zoom: 0.5 }, -0.1).zoom).toBe(0.4);
    expect(resetFrame({ ...FREE, zoom: 0.4, offsetX: 2 })).toEqual(FREE);
    expect(resetFrame({ ...DEFAULT_FRAME, zoom: 3 })).toBe(DEFAULT_FRAME);
  });
});
