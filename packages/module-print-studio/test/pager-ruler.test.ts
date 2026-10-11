import { inches, mm } from '../src/domain/units.js';
import { pagerItems, type StudioPagerItem } from '../src/react/view/pager.js';
import { editorRulerMarks, rulerReading, rulerTicks } from '../src/react/view/ruler-ticks.js';

/** The pager as a person reads it: page numbers from 1, and "…" for a gap. */
function read(items: readonly StudioPagerItem[]): string {
  return items.map((item) => (item.kind === 'page' ? String(item.index + 1) : '…')).join(' ');
}

describe('pagerItems', () => {
  it('shows every page while there are seven or fewer', () => {
    expect(read(pagerItems(1, 0))).toBe('1');
    expect(read(pagerItems(7, 3))).toBe('1 2 3 4 5 6 7');
  });

  it('runs out to the near end with one gap', () => {
    expect(read(pagerItems(20, 0))).toBe('1 2 3 4 5 … 20');
    expect(read(pagerItems(20, 3))).toBe('1 2 3 4 5 … 20');
    expect(read(pagerItems(20, 19))).toBe('1 … 16 17 18 19 20');
    expect(read(pagerItems(20, 16))).toBe('1 … 16 17 18 19 20');
  });

  it('keeps the current page with a neighbour each side in the middle', () => {
    expect(read(pagerItems(20, 9))).toBe('1 … 9 10 11 … 20');
    expect(read(pagerItems(50, 4))).toBe('1 … 4 5 6 … 50');
  });

  it('never shows more than seven items, and keeps the current page among them', () => {
    for (let count = 1; count <= 30; count += 1) {
      for (let current = 0; current < count; current += 1) {
        const items = pagerItems(count, current);
        expect(items.length).toBeLessThanOrEqual(7);
        expect(items.some((item) => item.kind === 'page' && item.index === current)).toBe(true);
      }
    }
  });
});

describe('rulerTicks', () => {
  it('numbers every centimetre in millimetres or centimetres, as chosen', () => {
    // 4 px a millimetre: every tick fits, every centimetre is numbered.
    const perUnit = 4 / mm(1);
    const inMm = rulerTicks(mm(30), 'mm', perUnit);
    expect(inMm.filter((tick) => tick.label).map((tick) => tick.label)).toEqual(['0', '10', '20', '30']);
    expect(inMm).toHaveLength(31);
    const inCm = rulerTicks(mm(30), 'cm', perUnit);
    expect(inCm.filter((tick) => tick.label).map((tick) => tick.label)).toEqual(['0', '1', '2', '3']);
    expect(inCm.find((tick) => tick.at === mm(5))?.level).toBe('mid');
  });

  it('ticks eighths of an inch and numbers the inches', () => {
    const ticks = rulerTicks(inches(2), 'in', 8 / (inches(1) / 8));
    expect(ticks).toHaveLength(17);
    expect(ticks.filter((tick) => tick.label).map((tick) => tick.label)).toEqual(['0', '1', '2']);
    expect(ticks.find((tick) => tick.at === inches(0.5))?.level).toBe('mid');
  });

  it('leaves out ticks too close to see, and numbers fewer as the sheet gets smaller', () => {
    // An A4 width fitted into about 400 px: under 2 px a millimetre.
    const fitted = rulerTicks(mm(210), 'mm', 400 / mm(210));
    expect(fitted.some((tick) => tick.level === 'minor')).toBe(false);
    expect(fitted.filter((tick) => tick.label).map((tick) => tick.label)).toEqual([
      '0',
      '20',
      '40',
      '60',
      '80',
      '100',
      '120',
      '140',
      '160',
      '180',
      '200',
    ]);
  });

  it('draws nothing for a sheet with no size', () => {
    expect(rulerTicks(0, 'mm', 1)).toEqual([]);
    expect(rulerTicks(mm(10), 'mm', 0)).toEqual([]);
  });
});

describe('rulerReading', () => {
  it('reads the pointer in the ruler’s unit, to a sensible place', () => {
    expect(rulerReading(mm(84.56), 'mm')).toBe('84.6');
    expect(rulerReading(mm(84.56), 'cm')).toBe('8.46');
    expect(rulerReading(inches(1.5), 'in')).toBe('1.50');
  });

  it('reads past the paper’s edge as a negative, and a hair left of it as 0', () => {
    expect(rulerReading(-mm(3), 'mm')).toBe('-3.0');
    expect(rulerReading(-1, 'mm')).toBe('0.0');
  });
});

describe('editorRulerMarks', () => {
  /** The editor at 100%: 96 pixels to the inch. */
  const perUnit = 96 / inches(1);

  it('numbers the same marks in millimetres or in centimetres', () => {
    const inMm = editorRulerMarks(400, 'mm', perUnit);
    const inCm = editorRulerMarks(400, 'cm', perUnit);
    expect(inMm.map((mark) => mark.at)).toEqual(inCm.map((mark) => mark.at));
    expect(inMm.filter((mark) => mark.label).map((mark) => mark.label)).toEqual([
      '10',
      '20',
      '30',
      '40',
      '50',
      '60',
      '70',
      '80',
      '90',
      '100',
    ]);
    expect(inCm.filter((mark) => mark.label).map((mark) => mark.label)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ]);
  });

  it('puts an inch every 96 pixels, with eighths between', () => {
    const marks = editorRulerMarks(300, 'in', perUnit);
    expect(marks.filter((mark) => mark.label).map((mark) => [mark.label, Math.round(mark.at)])).toEqual([
      ['1', 96],
      ['2', 192],
      ['3', 288],
    ]);
    expect(marks.filter((mark) => mark.at < 96).map((mark) => mark.size)).toEqual([10, 4, 4, 4, 7, 4, 4, 4]);
  });

  it('follows the zoom: at 200% an inch is 192 pixels', () => {
    const marks = editorRulerMarks(400, 'in', perUnit * 2);
    expect(marks.filter((mark) => mark.label).map((mark) => Math.round(mark.at))).toEqual([192, 384]);
  });

  it('writes no number at 0 or against the far end, where half of it would be cut off', () => {
    // Exactly two inches long: the 2 would sit on the ruler's last pixel.
    const marks = editorRulerMarks(192, 'in', perUnit);
    expect(marks.filter((mark) => mark.label).map((mark) => mark.label)).toEqual(['1']);
    expect(marks[0]).toEqual({ at: 0, size: 10 });
  });

  it('draws nothing for a ruler with no length', () => {
    expect(editorRulerMarks(0, 'mm', perUnit)).toEqual([]);
    expect(editorRulerMarks(100, 'mm', 0)).toEqual([]);
  });
});
