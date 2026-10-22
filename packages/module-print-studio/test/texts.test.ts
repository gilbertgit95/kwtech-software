import {
  emptyLayoutSpec,
  layoutOnPage,
  prepareLayoutSpec,
  printableArea,
  type StudioLayoutSpec,
} from '../src/domain/layout.js';
import { findStudioPaper } from '../src/domain/papers.js';
import {
  checkTexts,
  newText,
  placeText,
  readText,
  STUDIO_TEXT_SIZE_MAX,
  STUDIO_TEXT_SIZE_MIN,
  STUDIO_TEXTS_MAX,
  type StudioText,
  textCopyPosition,
  textHeight,
  textPoints,
  textsOnArea,
  textUnits,
} from '../src/domain/texts.js';
import { inches, mm } from '../src/domain/units.js';

const FOUR_R = { key: '4r', label: '4R', width: inches(4), height: inches(6) };

function spec(overrides: Partial<StudioLayoutSpec> = {}): StudioLayoutSpec {
  return { ...emptyLayoutSpec(FOUR_R, mm(3)), ...overrides };
}

function text(overrides: Partial<StudioText> = {}): StudioText {
  return { ...newText('t1'), ...overrides };
}

describe('font sizes', () => {
  it('stores points as units and shows them back as the same points', () => {
    expect(textUnits(12)).toBe(423);
    expect(textPoints(textUnits(12))).toBe(12);
    expect(textPoints(textUnits(10.5))).toBe(10.5);
    expect(textPoints(STUDIO_TEXT_SIZE_MIN)).toBe(4);
    expect(textPoints(STUDIO_TEXT_SIZE_MAX)).toBe(200);
  });

  it('measures a text’s height by its lines', () => {
    expect(textHeight(text({ text: 'one', size: 1000 }))).toBe(1200);
    expect(textHeight(text({ text: 'one\ntwo\nthree', size: 1000 }))).toBe(3600);
  });
});

describe('placeText', () => {
  const area = { width: 10_000, height: 5_000 };

  it('keeps the whole text inside the printable area', () => {
    expect(placeText(area, { width: 2_000, height: 500 }, { x: 9_000, y: -40 })).toEqual({ x: 8_000, y: 0 });
    expect(placeText(area, { width: 2_000, height: 500 }, { x: 1_234.4, y: 4_800 })).toEqual({ x: 1_234, y: 4_500 });
  });

  it('starts a text larger than the area at its top left', () => {
    expect(placeText(area, { width: 20_000, height: 9_000 }, { x: 500, y: 500 })).toEqual({ x: 0, y: 0 });
  });
});

describe('textCopyPosition', () => {
  it('starts a copy at the text’s bottom left corner, under its last line', () => {
    expect(textCopyPosition(text({ x: 500, y: 1000, text: 'one\ntwo', size: 1000 }))).toEqual({ x: 500, y: 3400 });
  });

  it('adds the offset from that corner, either way', () => {
    const from = text({ x: 500, y: 1000, text: 'one', size: 1000 });
    expect(textCopyPosition(from, { x: mm(2), y: -mm(1) })).toEqual({ x: 700, y: 2100 });
  });
});

describe('texts on another page', () => {
  it('keeps a fixed layout’s text where it is, pulled inside a smaller page', () => {
    const texts = [text({ x: 1_000, y: 9_000 })];
    const moved = textsOnArea(texts, { width: 10_000, height: 15_000 }, { width: 8_000, height: 6_000 }, false);
    expect(moved[0]).toMatchObject({ x: 1_000, y: 6_000 });
  });

  it('keeps a percent layout’s text at its share of the page, at the same font size', () => {
    const texts = [text({ x: 2_500, y: 5_000, size: 500 })];
    const moved = textsOnArea(texts, { width: 10_000, height: 10_000 }, { width: 20_000, height: 5_000 }, true);
    expect(moved[0]).toMatchObject({ x: 5_000, y: 2_500, size: 500 });
  });

  it('moves the texts with the paper in layoutOnPage', () => {
    const a4 = findStudioPaper('a4');
    if (!a4) throw new Error('A4 is a built-in paper.');
    const paper = { key: a4.key, label: a4.label, width: a4.width, height: a4.height };
    const percent = spec({ sizing: 'percent', texts: [text({ x: 0, y: printableArea(spec()).height })] });
    const onA4 = layoutOnPage(percent, { paper });
    expect(onA4.texts?.[0]?.y).toBe(printableArea(onA4).height);
    // No texts stays no texts: a layout saved before there was text is unchanged.
    expect(layoutOnPage(spec(), { paper }).texts).toBeUndefined();
  });
});

describe('checkTexts', () => {
  const area = { width: 10_000, height: 10_000 };

  it('passes texts that start inside the area', () => {
    expect(checkTexts([text({ x: 10_000, y: 0 })], area)).toBeNull();
  });

  it('refuses an empty text, one outside, and too many', () => {
    expect(checkTexts([text({ text: '  \n ' })], area)).toBe('text_empty');
    expect(checkTexts([text({ x: 10_001 })], area)).toBe('text_outside');
    const many = Array.from({ length: STUDIO_TEXTS_MAX + 1 }, (_, index) => text({ id: `t${index}` }));
    expect(checkTexts(many, area)).toBe('too_many_texts');
  });
});

describe('readText', () => {
  it('stores a colour in lower case', () => {
    expect(readText(text({ color: '#DC2626' }))?.color).toBe('#dc2626');
  });

  it('keeps lines and drops control characters within them', () => {
    expect(readText(text({ text: 'Kw\u0007Tech\r\nPhoto  ' }))?.text).toBe('Kw Tech\nPhoto');
  });

  it('refuses what is not a text', () => {
    expect(readText(null)).toBeNull();
    expect(readText({ ...text(), font: 'Wingdings' })).toBeNull();
    expect(readText({ ...text(), weight: 900 })).toBeNull();
    expect(readText({ ...text(), size: STUDIO_TEXT_SIZE_MAX + 1 })).toBeNull();
    expect(readText({ ...text(), x: 1.5 })).toBeNull();
    expect(readText({ ...text(), id: 'not an id!' })).toBeNull();
    expect(readText({ ...text(), underline: 'yes' })).toBeNull();
    expect(readText({ ...text(), strike: undefined })).toBeNull();
    expect(readText({ ...text(), color: 'red' })).toBeNull();
    expect(readText({ ...text(), color: '#fff' })).toBeNull();
    expect(readText({ ...text(), color: undefined })).toBeNull();
    expect(readText({ ...text(), text: 'line\n'.repeat(25) })).toBeNull();
  });
});

describe('prepareLayoutSpec with texts', () => {
  it('keeps the texts, rebuilt from known fields', () => {
    const prepared = prepareLayoutSpec({ ...spec(), texts: [{ ...text(), extra: 'dropped' }] });
    expect(prepared).toEqual({ spec: { ...spec(), texts: [text()] } });
  });

  it('stores no texts as absent, whether left out, null or empty', () => {
    for (const texts of [undefined, null, []]) {
      const prepared = prepareLayoutSpec({ ...spec(), texts });
      expect('spec' in prepared ? 'texts' in prepared.spec : 'refused').toBe(false);
    }
  });

  it('refuses two texts with one id, a text outside, and an empty one', () => {
    expect(prepareLayoutSpec({ ...spec(), texts: [text(), text()] })).toEqual({ refused: 'invalid_spec' });
    expect(prepareLayoutSpec({ ...spec(), texts: [text({ y: inches(7) })] })).toEqual({ refused: 'text_outside' });
    expect(prepareLayoutSpec({ ...spec(), texts: [text({ text: '' })] })).toEqual({ refused: 'text_empty' });
    expect(prepareLayoutSpec({ ...spec(), texts: 'Hello' })).toEqual({ refused: 'invalid_spec' });
  });
});
