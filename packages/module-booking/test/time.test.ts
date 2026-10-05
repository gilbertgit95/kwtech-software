import {
  addBookingDays,
  bookingDayFromDate,
  bookingDayRange,
  bookingDayToDate,
  bookingWeekday,
  parseBookingInstant,
  prepareBookingDay,
  workspaceBookingDay,
  zonedInstant,
} from '../src/domain/time.js';

describe('prepareBookingDay', () => {
  it('takes a real calendar day', () => {
    expect(prepareBookingDay('2026-10-05')).toEqual({ day: '2026-10-05' });
  });

  it('refuses a day that does not exist rather than rolling it into the next month', () => {
    expect(prepareBookingDay('2026-02-30')).toEqual({ refused: 'invalid_day' });
  });

  it('refuses anything that is not a day', () => {
    for (const raw of ['', 'today', '2026-10-5', '2026-10-05T09:00:00Z', null, undefined]) {
      expect(prepareBookingDay(raw)).toEqual({ refused: 'invalid_day' });
    }
  });
});

describe('a DATE column', () => {
  it('goes to the database and back as the same day', () => {
    expect(bookingDayFromDate(bookingDayToDate('2026-10-05'))).toBe('2026-10-05');
  });
});

describe('the workspace’s day', () => {
  // 15:00 UTC on the 5th is 23:00 that day in Manila and still the 5th in London — an hour later Manila is on the 6th.
  const elevenPmInManila = new Date('2026-10-05T15:00:00Z');
  const justPastMidnightInManila = new Date('2026-10-05T16:30:00Z');

  it('⚠ puts an 11 PM booking in Manila on that day, not on the server’s', () => {
    expect(workspaceBookingDay(elevenPmInManila, 'Asia/Manila')).toBe('2026-10-05');
    expect(workspaceBookingDay(justPastMidnightInManila, 'Asia/Manila')).toBe('2026-10-06');
  });

  it('⚠ answers differently for the same instant in another zone', () => {
    expect(workspaceBookingDay(justPastMidnightInManila, 'Europe/London')).toBe('2026-10-05');
    expect(workspaceBookingDay(justPastMidnightInManila, 'UTC')).toBe('2026-10-05');
  });

  it('covers the instants of the workspace’s day, from its own midnight', () => {
    const range = bookingDayRange('2026-10-05', 'Asia/Manila');
    expect(range?.from.toISOString()).toBe('2026-10-04T16:00:00.000Z');
    expect(range?.until.toISOString()).toBe('2026-10-05T16:00:00.000Z');
  });

  it('knows the weekday of a day without a zone', () => {
    // 5 October 2026 is a Monday.
    expect(bookingWeekday('2026-10-05')).toBe(1);
    expect(bookingWeekday('nonsense')).toBeNull();
  });

  it('adds days across a month', () => {
    expect(addBookingDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addBookingDays('2026-10-01', -1)).toBe('2026-09-30');
  });
});

describe('zonedInstant', () => {
  it('turns a minute of the workspace’s day into the instant it is', () => {
    // 9:00 in Manila is 01:00 UTC.
    expect(zonedInstant('2026-10-05', 9 * 60, 'Asia/Manila')?.toISOString()).toBe('2026-10-05T01:00:00.000Z');
  });

  it('⚠ is the same wall time in another zone, and so another instant', () => {
    expect(zonedInstant('2026-10-05', 9 * 60, 'Europe/London')?.toISOString()).toBe('2026-10-05T08:00:00.000Z');
  });

  it('takes 1440 as the end of the day', () => {
    expect(zonedInstant('2026-10-05', 1440, 'Asia/Manila')?.toISOString()).toBe('2026-10-05T16:00:00.000Z');
  });

  it('⚠ keeps 9:00 at 9:00 on the day the clocks change', () => {
    // New York springs forward on 8 March 2026: 9:00 is 14:00 UTC the day before and 13:00 UTC on the day.
    expect(zonedInstant('2026-03-07', 9 * 60, 'America/New_York')?.toISOString()).toBe('2026-03-07T14:00:00.000Z');
    expect(zonedInstant('2026-03-08', 9 * 60, 'America/New_York')?.toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });

  it('answers null for a day that is not one', () => {
    expect(zonedInstant('2026-02-30', 0, 'Asia/Manila')).toBeNull();
  });
});

describe('parseBookingInstant', () => {
  it('takes an instant with its zone, on a whole minute', () => {
    expect(parseBookingInstant('2026-10-05T01:00:00.000Z')?.toISOString()).toBe('2026-10-05T01:00:00.000Z');
    expect(parseBookingInstant('2026-10-05T09:00:00+08:00')?.toISOString()).toBe('2026-10-05T01:00:00.000Z');
  });

  it('⚠ refuses a time with no zone, which the server would read as its own', () => {
    expect(parseBookingInstant('2026-10-05T09:00:00')).toBeNull();
  });

  it('refuses seconds, and nonsense', () => {
    expect(parseBookingInstant('2026-10-05T01:00:30Z')).toBeNull();
    expect(parseBookingInstant('soon')).toBeNull();
    expect(parseBookingInstant(null)).toBeNull();
  });
});
