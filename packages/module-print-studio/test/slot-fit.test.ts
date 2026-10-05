import {
  clampCrop,
  clampFrame,
  DEFAULT_FRAME,
  effectiveDpi,
  nextRotation,
  panFrame,
  sourceRect,
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
