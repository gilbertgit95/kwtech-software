import {
  centreBackground,
  clampOpacity,
  fitBackground,
  moveBackground,
  newBackground,
  resizeBackground,
  STUDIO_BACKGROUND_SCALE_MAX,
  STUDIO_BACKGROUND_VISIBLE_MIN,
  STUDIO_BACKGROUND_WIDTH_MIN,
} from '../src/domain/background.js';

/** A landscape picture, 2:1, on a portrait sheet whose printable area is 10 000 × 20 000 at (500, 500). */
const IMAGE = { width: 2000, height: 1000 };
const SHEET = { width: 11_000, height: 21_000 };
const AREA = { x: 500, y: 500, width: 10_000, height: 20_000 };

describe('fitBackground', () => {
  it('fills the area, centred and cut at the sides, at the picture’s own shape', () => {
    expect(fitBackground(IMAGE, AREA, 'fill')).toEqual({ x: -14_500, y: 500, width: 40_000, height: 20_000 });
  });

  it('fits the whole picture inside the area, centred', () => {
    expect(fitBackground(IMAGE, AREA, 'fit')).toEqual({ x: 500, y: 8_000, width: 10_000, height: 5_000 });
  });

  it('starts a new background filling the area at full strength', () => {
    expect(newBackground(IMAGE, AREA)).toEqual({ rect: fitBackground(IMAGE, AREA, 'fill'), opacity: 100 });
  });
});

describe('resizeBackground', () => {
  const rect = { x: 1000, y: 1000, width: 4000, height: 2000 };

  it('keeps the shape and the centre for the size slider', () => {
    expect(resizeBackground(rect, 6000, IMAGE, SHEET, 'centre')).toEqual({ x: 0, y: 500, width: 6000, height: 3000 });
  });

  it('keeps the top left for a drag of the corner', () => {
    expect(resizeBackground(rect, 2000, IMAGE, SHEET, 'corner')).toEqual({
      x: 1000,
      y: 1000,
      width: 2000,
      height: 1000,
    });
  });

  it('never goes under the smallest width or past the largest', () => {
    expect(resizeBackground(rect, 1, IMAGE, SHEET, 'corner').width).toBe(STUDIO_BACKGROUND_WIDTH_MIN);
    expect(resizeBackground(rect, 10 ** 9, IMAGE, SHEET, 'corner').width).toBe(21_000 * STUDIO_BACKGROUND_SCALE_MAX);
  });
});

describe('moveBackground', () => {
  const rect = { x: 0, y: 0, width: 4000, height: 2000 };

  it('moves to where it is dragged', () => {
    expect(moveBackground(rect, { x: 1234.4, y: -500 }, SHEET)).toEqual({ ...rect, x: 1234, y: -500 });
  });

  it('keeps some of it on the sheet, so it can be found again', () => {
    const lost = moveBackground(rect, { x: 50_000, y: -50_000 }, SHEET);
    expect(lost.x).toBe(SHEET.width - STUDIO_BACKGROUND_VISIBLE_MIN);
    expect(lost.y).toBe(STUDIO_BACKGROUND_VISIBLE_MIN - rect.height);
  });
});

describe('centreBackground and clampOpacity', () => {
  it('centres the picture at its size', () => {
    expect(centreBackground({ x: 0, y: 0, width: 4000, height: 2000 }, AREA)).toEqual({
      x: 3500,
      y: 9500,
      width: 4000,
      height: 2000,
    });
  });

  it('keeps an opacity a whole percent between 0 and 100', () => {
    expect(clampOpacity(42.6)).toBe(43);
    expect(clampOpacity(-5)).toBe(0);
    expect(clampOpacity(250)).toBe(100);
    expect(clampOpacity(Number.NaN)).toBe(100);
  });
});
