import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rangeCell, rangeStep, tapRangeDay } from '../src/react/view/phone-period.js';

/** The phone's period picker (issue #72): a custom range is two taps on one calendar. */
describe('tapRangeDay', () => {
  const empty = { fromDay: null, toDay: null };

  it('starts the range on the first tap, and ends it on the second', () => {
    const first = tapRangeDay(empty, '2026-11-02');
    expect(first).toEqual({ fromDay: '2026-11-02', toDay: null });
    expect(tapRangeDay(first, '2026-11-05')).toEqual({ fromDay: '2026-11-02', toDay: '2026-11-05' });
  });

  it('takes the same day twice as a range of one day', () => {
    expect(tapRangeDay({ fromDay: '2026-11-02', toDay: null }, '2026-11-02')).toEqual({
      fromDay: '2026-11-02',
      toDay: '2026-11-02',
    });
  });

  it('⚠ never makes a backwards range: a tap before the start moves the start', () => {
    expect(tapRangeDay({ fromDay: '2026-11-05', toDay: null }, '2026-11-01')).toEqual({
      fromDay: '2026-11-01',
      toDay: null,
    });
  });

  it('starts again from a whole range, rather than guessing which end moved', () => {
    expect(tapRangeDay({ fromDay: '2026-11-01', toDay: '2026-11-05' }, '2026-11-03')).toEqual({
      fromDay: '2026-11-03',
      toDay: null,
    });
  });
});

describe('rangeCell', () => {
  const range = { fromDay: '2026-11-02', toDay: '2026-11-05' };

  it('marks the ends and the days between', () => {
    expect(rangeCell('2026-11-02', range)).toBe('start');
    expect(rangeCell('2026-11-03', range)).toBe('inside');
    expect(rangeCell('2026-11-04', range)).toBe('inside');
    expect(rangeCell('2026-11-05', range)).toBe('end');
    expect(rangeCell('2026-11-01', range)).toBe(null);
    expect(rangeCell('2026-11-06', range)).toBe(null);
  });

  it('shows a first day alone, or a range of one day, as a single end', () => {
    expect(rangeCell('2026-11-02', { fromDay: '2026-11-02', toDay: null })).toBe('single');
    expect(rangeCell('2026-11-03', { fromDay: '2026-11-02', toDay: null })).toBe(null);
    expect(rangeCell('2026-11-02', { fromDay: '2026-11-02', toDay: '2026-11-02' })).toBe('single');
  });

  it('marks nothing before a first tap', () => {
    expect(rangeCell('2026-11-02', { fromDay: null, toDay: null })).toBe(null);
  });
});

describe('rangeStep', () => {
  it('says which tap is next, then that the range is ready', () => {
    expect(rangeStep({ fromDay: null, toDay: null })).toBe('first');
    expect(rangeStep({ fromDay: '2026-11-02', toDay: null })).toBe('last');
    expect(rangeStep({ fromDay: '2026-11-02', toDay: '2026-11-05' })).toBe('ready');
  });
});

/**
 * The wiring, read from the source (no React render tests here).
 * ⚠ `__dirname`: this suite compiles to CommonJS.
 */
const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

describe('the phone’s Orders uses the phone’s picker', () => {
  const phone = read('src/react/components/phone-orders.tsx');
  const picker = read('src/react/components/phone-period-picker.tsx');

  it('draws PhonePeriodPicker, never the full screen’s PeriodPicker', () => {
    expect(phone).toMatch(/<PhonePeriodPicker/);
    expect(phone).not.toMatch(/<PeriodPicker/);
  });

  it('applies a custom range only once prepareCustomDays accepts it, with the full screen’s limits', () => {
    expect(picker).toMatch(/prepareCustomDays\(draft\.fromDay, draft\.toDay\)/);
  });

  it('⚠ lets no day after the store’s today be picked', () => {
    expect(picker).toMatch(/const later = cell\.day > today;/);
    expect(picker).toMatch(/disabled=\{later\}/);
  });

  it('uses web-ui’s calendar rules, not the browser’s date input (issue #4)', () => {
    expect(picker).toMatch(/monthCells\(month\)/);
    // An <input> of any kind; the doc comment names `<input type="date">` in backticks to say why not.
    expect(picker).not.toMatch(/[^`]<input\b/);
  });
});
