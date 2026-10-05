import {
  adjustPixels,
  clampLighting,
  isNeutralLighting,
  lightingTables,
  NEUTRAL_LIGHTING,
} from '../src/domain/adjust.js';

function pixel(red: number, green: number, blue: number, alpha = 255): Uint8ClampedArray {
  return new Uint8ClampedArray([red, green, blue, alpha]);
}

function adjusted(source: Uint8ClampedArray, lighting: Partial<typeof NEUTRAL_LIGHTING>): number[] {
  const copy = new Uint8ClampedArray(source);
  adjustPixels(copy, { ...NEUTRAL_LIGHTING, ...lighting });
  return [...copy];
}

describe('adjustPixels', () => {
  it('changes nothing when every slider is at rest', () => {
    expect(adjusted(pixel(10, 120, 250), {})).toEqual([10, 120, 250, 255]);
    expect(isNeutralLighting(NEUTRAL_LIGHTING)).toBe(true);
  });

  it('lightens and darkens every channel by the same amount', () => {
    expect(adjusted(pixel(100, 100, 100), { brightness: 100 })).toEqual([210, 210, 210, 255]);
    expect(adjusted(pixel(100, 100, 100), { brightness: -100 })).toEqual([0, 0, 0, 255]);
  });

  it('pushes values away from mid grey for more contrast, and towards it for less', () => {
    expect(adjusted(pixel(64, 128, 192), { contrast: 100 })).toEqual([0, 128, 255, 255]);
    expect(adjusted(pixel(64, 128, 192), { contrast: -100 })).toEqual([96, 128, 160, 255]);
  });

  it('warms by lifting red and lowering blue, and cools the other way', () => {
    expect(adjusted(pixel(100, 100, 100), { warmth: 100 })).toEqual([140, 100, 60, 255]);
    expect(adjusted(pixel(100, 100, 100), { warmth: -100 })).toEqual([60, 100, 140, 255]);
  });

  it('turns a colour to its own brightness in black and white', () => {
    const [red, green, blue] = adjusted(pixel(255, 0, 0), { grayscale: true });
    expect(red).toBe(76);
    expect(green).toBe(76);
    expect(blue).toBe(76);
  });

  it('removes colour at −100 saturation and leaves grey alone at +100', () => {
    expect(adjusted(pixel(255, 0, 0), { saturation: -100 })).toEqual([76, 76, 76, 255]);
    expect(adjusted(pixel(90, 90, 90), { saturation: 100 })).toEqual([90, 90, 90, 255]);
  });

  it('leaves alpha alone and never leaves the byte range', () => {
    expect(adjusted(pixel(250, 250, 250, 17), { brightness: 100, contrast: 100 })).toEqual([255, 255, 255, 17]);
  });

  it('walks every pixel of a buffer', () => {
    const two = new Uint8ClampedArray([0, 0, 0, 255, 200, 200, 200, 255]);
    adjustPixels(two, { ...NEUTRAL_LIGHTING, brightness: 100 });
    expect([...two]).toEqual([110, 110, 110, 255, 255, 255, 255, 255]);
  });
});

describe('lighting values', () => {
  it('are kept whole and inside the slider’s range', () => {
    expect(
      clampLighting({ brightness: 250, contrast: -250, saturation: 12.6, warmth: Number.NaN, grayscale: true }),
    ).toEqual({
      brightness: 100,
      contrast: -100,
      saturation: 13,
      warmth: 0,
      grayscale: true,
    });
  });

  it('give tables that leave a value alone when neutral', () => {
    const tables = lightingTables(NEUTRAL_LIGHTING);
    expect(tables.red[37]).toBe(37);
    expect(tables.blue[255]).toBe(255);
  });
});
