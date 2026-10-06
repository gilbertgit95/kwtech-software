import { emptyLayoutSpec } from '../src/domain/layout.js';
import { findStudioPreset } from '../src/domain/presets.js';
import { inches, mm } from '../src/domain/units.js';
import { lengthText, parseLength, scaleText } from '../src/react/view/lengths.js';
import { cellGroups, cellLabelSize, layoutSummary, paperName, plural, sizeName } from '../src/react/view/summary.js';

describe('parseLength', () => {
  it('reads a bare number in the field’s own unit', () => {
    expect(parseLength('35', 'mm')).toBe(mm(35));
    expect(parseLength('1.5', 'in')).toBe(inches(1.5));
    expect(parseLength(' 0 ', 'mm')).toBe(0);
  });

  it('lets a typed unit win over the field’s', () => {
    expect(parseLength('1 in', 'mm')).toBe(inches(1));
    expect(parseLength('2"', 'mm')).toBe(inches(2));
    expect(parseLength('25.4mm', 'in')).toBe(inches(1));
    expect(parseLength('2 INCHES', 'mm')).toBe(inches(2));
  });

  it('reads a comma as a decimal point', () => {
    expect(parseLength('35,5', 'mm')).toBe(mm(35.5));
    expect(parseLength('.5', 'in')).toBe(inches(0.5));
  });

  it.each(['', 'abc', '-3', '3 cm', '1 2', '1e3', 'Infinity'])('refuses "%s"', (text) => {
    expect(parseLength(text, 'mm')).toBeNull();
  });
});

describe('showing lengths', () => {
  it('gives the number an input shows, without trailing zeros', () => {
    expect(lengthText(inches(1), 'in')).toBe('1');
    expect(lengthText(inches(1), 'mm')).toBe('25.4');
    expect(lengthText(mm(3), 'mm')).toBe('3');
    expect(scaleText(10050)).toBe('100.5');
    expect(scaleText(10000)).toBe('100');
  });
});

describe('summarising a layout', () => {
  it('groups cells by size, largest first, upright and sideways together', () => {
    const cells = findStudioPreset('a4-id-1-2')?.spec.cells ?? [];
    const groups = cellGroups(cells, 'in');
    expect(groups[0]).toEqual({ label: '2 × 2 in', count: 4 });
    expect(groups[1]?.label).toBe('1 × 1 in');

    const passport = findStudioPreset('a4-id-passport')?.spec.cells ?? [];
    expect(cellGroups(passport, 'mm')).toEqual([{ label: 'Passport', count: 10 }]);
  });

  it('names a size it knows and measures one it does not', () => {
    expect(sizeName(mm(35), mm(45), 'mm')).toBe('Passport');
    expect(sizeName(inches(2.5), inches(3.5), 'in')).toBe('2R');
    expect(sizeName(mm(30), mm(40), 'mm')).toBe('30 × 40 mm');
  });

  it('names the paper, and says when it is landscape', () => {
    const spec = emptyLayoutSpec({ key: '4r', label: '4R', width: inches(4), height: inches(6) }, mm(3));
    expect(paperName(spec, 'mm')).toBe('4R');
    expect(paperName({ ...spec, orientation: 'landscape' }, 'mm')).toBe('4R, landscape');
    const custom = emptyLayoutSpec({ key: null, label: '', width: mm(100), height: mm(150) }, 0);
    expect(paperName(custom, 'mm')).toBe('100 × 150 mm');
  });

  it('says a layout in a line', () => {
    const preset = findStudioPreset('a4-id-1x1');
    expect(preset ? layoutSummary(preset.spec, 'in') : '').toBe('A4 · 21 of 1 × 1 in');
    const empty = emptyLayoutSpec({ key: 'a4', label: 'A4', width: mm(210), height: mm(297) }, 0);
    expect(layoutSummary(empty, 'mm')).toBe('A4 · no cells yet');
  });

  it('⚠ writes a short label at a fifth of the cell, and shrinks a long one so it stays inside', () => {
    const inch = { width: inches(1), height: inches(1) };
    expect(cellLabelSize(inch, '1 × 1')).toBe(inches(1) / 5);
    // A wide, flat cell: the height decides.
    expect(cellLabelSize({ width: inches(6), height: inches(1) }, '4R')).toBe(inches(1) / 3);

    const card = { width: mm(54), height: mm(85.6) };
    const size = cellLabelSize(card, '54 × 85.6 mm');
    expect(size).toBeLessThan(card.width / 5);
    // Twelve characters, at the widest a character is drawn, fit inside the cell with room to spare.
    expect(12 * 0.6 * size).toBeLessThanOrEqual(card.width * 0.8 + 1e-6);
    expect(cellLabelSize(inch, '')).toBe(inches(1) / 5);
  });

  it('counts in words', () => {
    expect(plural(1, 'page')).toBe('1 page');
    expect(plural(3, 'page')).toBe('3 pages');
    expect(plural(2, 'copy', 'copies')).toBe('2 copies');
  });
});
