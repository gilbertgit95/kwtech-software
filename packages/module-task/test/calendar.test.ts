import {
  calendarKeyMove,
  longDayLabel,
  monthCells,
  monthLabel,
  monthOf,
  shiftMonth,
  shortDayLabel,
} from '../src/react/view/calendar.js';

describe('monthCells', () => {
  it('fills whole weeks from Sunday, marking the neighbouring months’ days', () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const cells = monthCells('2026-10');
    expect(cells).toHaveLength(35);
    expect(cells[0]).toEqual({ day: '2026-09-27', inMonth: false });
    expect(cells[4]).toEqual({ day: '2026-10-01', inMonth: true });
    expect(cells[34]).toEqual({ day: '2026-10-31', inMonth: true });
  });

  it('takes six rows when the month needs them, and four when it fits exactly', () => {
    // August 2026 starts on a Saturday: 31 days over six weeks.
    expect(monthCells('2026-08')).toHaveLength(42);
    // February 2026 starts on a Sunday and has 28 days.
    const february = monthCells('2026-02');
    expect(february).toHaveLength(28);
    expect(february.every((cell) => cell.inMonth)).toBe(true);
  });

  it('keeps 29 February in a leap year', () => {
    expect(monthCells('2028-02').filter((cell) => cell.inMonth)).toHaveLength(29);
  });
});

describe('months', () => {
  it('steps across a year boundary both ways', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthOf('2026-10-09')).toBe('2026-10');
  });

  it('names a month and a day without the machine’s zone moving them', () => {
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(shortDayLabel('2026-10-09')).toBe('Fri 9 Oct 2026');
    expect(longDayLabel('2026-10-01')).toBe('Thursday 1 October 2026');
  });
});

describe('calendarKeyMove', () => {
  it('moves a day with ← →, and a week with ↑ ↓, across months', () => {
    expect(calendarKeyMove('2026-10-01', 'ArrowLeft')).toBe('2026-09-30');
    expect(calendarKeyMove('2026-10-31', 'ArrowRight')).toBe('2026-11-01');
    expect(calendarKeyMove('2026-10-03', 'ArrowUp')).toBe('2026-09-26');
    expect(calendarKeyMove('2026-10-28', 'ArrowDown')).toBe('2026-11-04');
  });

  it('goes to the week’s Sunday and Saturday with Home and End', () => {
    // 2026-10-09 is a Friday.
    expect(calendarKeyMove('2026-10-09', 'Home')).toBe('2026-10-04');
    expect(calendarKeyMove('2026-10-09', 'End')).toBe('2026-10-10');
    expect(calendarKeyMove('2026-10-04', 'Home')).toBe('2026-10-04');
  });

  it('moves a month with Page Up and Page Down, stopping at a shorter month’s last day', () => {
    expect(calendarKeyMove('2026-10-09', 'PageDown')).toBe('2026-11-09');
    expect(calendarKeyMove('2026-01-31', 'PageDown')).toBe('2026-02-28');
    expect(calendarKeyMove('2028-03-31', 'PageUp')).toBe('2028-02-29');
  });

  it('leaves every other key alone', () => {
    expect(calendarKeyMove('2026-10-09', 'Enter')).toBeNull();
    expect(calendarKeyMove('2026-10-09', 'a')).toBeNull();
  });
});
