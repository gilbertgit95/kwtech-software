import { isValidTimeZone, nextDayKey, zonedDayKey, zonedHour, zonedStartOfDay } from '../src/domain/time-zone.js';

describe('the store’s calendar', () => {
  it('⚠ puts an 11:30 PM Manila sale on its own day, not the next UTC one', () => {
    // 23:30 in Manila (UTC+8) is 15:30 UTC the same day.
    const sale = new Date('2026-10-01T15:30:00Z');
    expect(zonedDayKey(sale, 'Asia/Manila')).toBe('2026-10-01');
    // …and 00:30 in Manila is still the previous day in UTC.
    expect(zonedDayKey(new Date('2026-10-01T16:30:00Z'), 'Asia/Manila')).toBe('2026-10-02');
    expect(zonedHour(sale, 'Asia/Manila')).toBe(23);
  });

  it('finds the instant a store day begins', () => {
    expect(zonedStartOfDay('2026-10-01', 'Asia/Manila')?.toISOString()).toBe('2026-09-30T16:00:00.000Z');
  });

  it('⚠ finds it across a daylight-saving change too', () => {
    // New York leaves daylight saving on 2026-11-01: that midnight is still EDT (UTC−4).
    expect(zonedStartOfDay('2026-11-01', 'America/New_York')?.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(zonedStartOfDay('2026-11-02', 'America/New_York')?.toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  it('refuses a malformed day, and a zone that does not exist', () => {
    expect(zonedStartOfDay('2026-02-30', 'Asia/Manila')).toBeNull();
    expect(zonedStartOfDay('yesterday', 'Asia/Manila')).toBeNull();
    expect(isValidTimeZone('Asia/Manila')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('steps days across months and years', () => {
    expect(nextDayKey('2026-12-31')).toBe('2027-01-01');
    expect(nextDayKey('2028-02-28')).toBe('2028-02-29');
  });
});
