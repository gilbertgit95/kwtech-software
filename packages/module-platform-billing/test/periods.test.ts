import {
  addDays,
  addMonthsAnchored,
  daysBetween,
  daysInPeriod,
  daysLeft,
  isDayKey,
  lastDayOf,
  nextPeriod,
  periodFrom,
  platformDay,
  platformDayStart,
} from '../src/index.js';

/**
 * Periods are one calendar month with a fixed billing day (plan §4). The traps
 * are short months, leap years and an instant read in the wrong time zone.
 */
describe('days', () => {
  it('knows a real day from a malformed one', () => {
    expect(isDayKey('2028-02-29')).toBe(true);
    expect(isDayKey('2026-02-29')).toBe(false);
    expect(isDayKey('2026-13-01')).toBe(false);
    expect(isDayKey('2026-1-01')).toBe(false);
  });

  it('adds days across a month and a year', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-11-01', '2026-12-01')).toBe(30);
    expect(daysBetween('2026-12-01', '2026-11-01')).toBe(-30);
  });

  it('throws on a malformed day rather than computing with it', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
    expect(() => platformDayStart('nope', 'Asia/Manila')).toThrow(RangeError);
  });

  it('⚠ reads an instant as the PLATFORM day, across a day boundary', () => {
    // 15:00 UTC on Nov 7 is 23:00 that day in Manila, and 16:00 on Nov 7 is Nov 8 there.
    expect(platformDay(new Date('2026-11-07T15:00:00Z'), 'Asia/Manila')).toBe('2026-11-07');
    expect(platformDay(new Date('2026-11-07T16:00:00Z'), 'Asia/Manila')).toBe('2026-11-08');
    expect(platformDay(new Date('2026-11-07T16:00:00Z'), 'Europe/London')).toBe('2026-11-07');
  });

  it('writes a day back as the instant it begins in the platform zone', () => {
    expect(platformDayStart('2026-11-08', 'Asia/Manila').toISOString()).toBe('2026-11-07T16:00:00.000Z');
  });
});

describe('a period with a fixed billing day', () => {
  it.each([
    ['a 30-day month', '2026-11-05', '2026-12-05', 30],
    ['a 31-day month', '2026-12-05', '2027-01-05', 31],
    ['February, 28 days', '2026-02-05', '2026-03-05', 28],
    ['February in a leap year, 29 days', '2028-02-05', '2028-03-05', 29],
  ])('%s', (_name, start, end, days) => {
    const period = periodFrom(start);
    expect(period).toEqual({ start, end, billingDay: 5 });
    expect(daysInPeriod(period)).toBe(days);
  });

  it('⚠ clamps the 31st to a short month and returns to it after', () => {
    const january = periodFrom('2026-01-31');
    const february = nextPeriod(january);
    const march = nextPeriod(february);
    expect(january.end).toBe('2026-02-28');
    expect(february).toEqual({ start: '2026-02-28', end: '2026-03-31', billingDay: 31 });
    expect(march.end).toBe('2026-04-30');
    expect(nextPeriod(march).end).toBe('2026-05-31');
  });

  it('clamps the 29th of February in a leap year, and back', () => {
    expect(addMonthsAnchored('2028-01-29', 1, 29)).toBe('2028-02-29');
    expect(addMonthsAnchored('2027-01-29', 1, 29)).toBe('2027-02-28');
    expect(addMonthsAnchored('2027-02-28', 1, 29)).toBe('2027-03-29');
  });

  it('refuses a billing day outside 1 to 31, or a fraction of a month', () => {
    expect(() => addMonthsAnchored('2026-01-01', 1, 0)).toThrow(RangeError);
    expect(() => addMonthsAnchored('2026-01-01', 1, 32)).toThrow(RangeError);
    expect(() => addMonthsAnchored('2026-01-01', 1.5, 1)).toThrow(RangeError);
  });

  it('counts the day of a change as the new plan’s, and nothing after the end', () => {
    const period = periodFrom('2026-11-01');
    expect(daysLeft(period, '2026-11-01')).toBe(30);
    expect(daysLeft(period, '2026-11-16')).toBe(15);
    expect(daysLeft(period, '2026-11-30')).toBe(1);
    expect(daysLeft(period, '2026-12-01')).toBe(0);
    expect(daysLeft(period, '2026-10-01')).toBe(30);
    expect(lastDayOf(period)).toBe('2026-11-30');
  });
});
