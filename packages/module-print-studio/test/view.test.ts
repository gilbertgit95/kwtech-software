import { emptyLayoutSpec } from '../src/domain/layout.js';
import { findStudioPreset } from '../src/domain/presets.js';
import { inches, mm } from '../src/domain/units.js';
import { lengthText, parseLength, parsePercent, percentText, scaleText } from '../src/react/view/lengths.js';
import {
  cannotTurnNote,
  LAYOUT_PAPER_VALUE,
  otherPaperNote,
  printPage,
  printPaperOptions,
  tooSmallPapersWarning,
} from '../src/react/view/print-paper.js';
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

describe('the papers a print may go on', () => {
  it('lists every built-in paper, marks the layout’s own, and disables the ones too small', () => {
    const preset = findStudioPreset('a4-id-1x1');
    if (!preset) throw new Error('The a4-id-1x1 preset is gone.');
    const options = printPaperOptions(preset.spec, 'mm');
    const byValue = new Map(options.map((option) => [option.value, option]));

    expect(options.filter((option) => option.own).map((option) => option.value)).toEqual(['a4']);
    expect(byValue.get('a4')?.label).toBe('A4 — 210 × 297 mm (the layout’s)');
    expect(byValue.get('a4')?.fits).toBe(true);
    // Seven 1 × 1s across do not fit on a 2.5 inch wide wallet print.
    expect(byValue.get('2r')?.fits).toBe(false);
    expect(byValue.get('2r')?.label).toBe('2R / Wallet — 2.5 × 3.5 in — too small');
    expect(tooSmallPapersWarning(options)).toMatch(/too small for this layout’s cells and cannot be chosen\.$/u);
  });

  it('puts a typed paper first, as the layout’s own, and warns about nothing when all fit', () => {
    const custom = emptyLayoutSpec({ key: null, label: '', width: mm(100), height: mm(150) }, 0);
    const options = printPaperOptions(custom, 'mm');
    expect(options[0]).toMatchObject({ value: LAYOUT_PAPER_VALUE, own: true, fits: true });
    expect(options[0]?.label).toBe('100 × 150 mm (the layout’s)');
    expect(options.filter((option) => option.own)).toHaveLength(1);
    expect(tooSmallPapersWarning(options)).toBeNull();
  });

  it('says one paper in the singular', () => {
    const spec = {
      ...emptyLayoutSpec({ key: '3r', label: '3R', width: inches(3.5), height: inches(5) }, 0),
      cells: [{ x: 0, y: 0, width: inches(3), height: inches(3) }],
    };
    expect(tooSmallPapersWarning(printPaperOptions(spec, 'mm'))).toBe(
      '1 paper is too small for this layout’s cells and cannot be chosen.',
    );
  });
});

describe('turning one print', () => {
  const A4 = { key: 'a4', label: 'A4', width: mm(210), height: mm(297) };
  // Fixed cells across the top of A4: inside the sheet either way round.
  const strip = { ...emptyLayoutSpec(A4, mm(5)), cells: [{ x: 0, y: 0, width: mm(200), height: mm(50) }] };
  // Fixed cells down the whole sheet: they hang off the bottom of it turned.
  const full = { ...emptyLayoutSpec(A4, mm(5)), cells: [{ x: 0, y: 0, width: mm(200), height: mm(287) }] };

  it('starts as the layout says, with nothing changed', () => {
    const page = printPage(strip, 'mm', null, null);
    expect(page).toMatchObject({ paper: A4, orientation: 'portrait', paperValue: 'a4', changed: false });
    expect(page.orientationOptions).toEqual([
      { value: 'portrait', label: 'Portrait', own: true, fits: true },
      { value: 'landscape', label: 'Landscape', own: false, fits: true },
    ]);
    expect(cannotTurnNote(page.orientationOptions)).toBeNull();
  });

  it('turns the sheet when the cells fit, and checks the papers that way round', () => {
    const page = printPage(strip, 'mm', null, 'landscape');
    expect(page).toMatchObject({ paper: A4, orientation: 'landscape', paperValue: 'a4', changed: true });
    // A5 turned is 210 mm wide: the 200 mm strip and its margins need exactly that.
    expect(page.paperOptions.find((option) => option.value === 'a5')?.fits).toBe(true);
    expect(printPage(strip, 'mm', null, null).paperOptions.find((option) => option.value === 'a5')?.fits).toBe(false);
  });

  it('⚠ does not offer a way round the cells hang off, and says why', () => {
    const page = printPage(full, 'mm', null, null);
    expect(page.orientationOptions.find((option) => option.value === 'landscape')?.fits).toBe(false);
    expect(cannotTurnNote(page.orientationOptions)).toBe(
      'This layout’s cells do not fit on this paper turned landscape.',
    );
  });

  it('⚠ falls back to the layout’s own page for a pick that does not fit', () => {
    expect(printPage(full, 'mm', null, 'landscape')).toMatchObject({
      paper: A4,
      orientation: 'portrait',
      changed: false,
    });
    // A paper too small the way the print is turned: the layout's own paper, turned the same way.
    expect(printPage(strip, 'mm', '2r', 'landscape')).toMatchObject({ paperValue: 'a4', orientation: 'landscape' });
  });

  it('marks the layout’s own paper too small when it is, turned', () => {
    const own = printPaperOptions(full, 'mm', 'landscape').find((option) => option.own);
    expect(own).toMatchObject({ fits: false, label: 'A4 — 210 × 297 mm (the layout’s) — too small' });
  });

  it('turns a percent layout either way', () => {
    const page = printPage({ ...full, sizing: 'percent' }, 'mm', null, 'landscape');
    expect(page.orientation).toBe('landscape');
    expect(cannotTurnNote(page.orientationOptions)).toBeNull();
  });
});

describe('percent layouts on the screens', () => {
  it('shows and reads a length as a share of another', () => {
    expect(percentText(mm(102), mm(204))).toBe('50');
    expect(percentText(mm(68), mm(204))).toBe('33.33');
    expect(percentText(mm(10), 0)).toBe('0');
    expect(parsePercent('50', mm(204))).toBe(mm(102));
    expect(parsePercent(' 33,33 % ', mm(204))).toBe(Math.round(0.3333 * mm(204)));
    for (const text of ['', 'half', '-5', '50 mm', '1e2']) expect(parsePercent(text, mm(204))).toBeNull();
  });

  it('lets a page grid go on every paper, and says its cells are resized', () => {
    const grid = findStudioPreset('a4-grid-2x2');
    if (!grid) throw new Error('The a4-grid-2x2 preset is gone.');
    const options = printPaperOptions(grid.spec, 'mm');
    expect(options.every((option) => option.fits)).toBe(true);
    expect(tooSmallPapersWarning(options)).toBeNull();
    expect(otherPaperNote(grid.spec)).toMatch(/resized/u);

    const fixed = findStudioPreset('a4-id-1x1');
    expect(fixed ? otherPaperNote(fixed.spec) : '').toMatch(/keep their sizes/u);
  });
});
