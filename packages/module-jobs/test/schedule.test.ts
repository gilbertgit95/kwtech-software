import type { ProcessScheduleLimits } from '@kwtech/module-kit';
import {
  adminSchedule,
  describeMinutes,
  describeSchedule,
  isSameSchedule,
  normalizeSchedule,
  scheduleRefusalMessage,
} from '../src/domain/schedule.js';

const NOW = new Date('2026-10-05T00:00:00Z');
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

describe('the admin’s schedule on a row', () => {
  const stored = { kind: 'interval', everyMinutes: 30 };

  it('is in force while it has a set-at', () => {
    expect(adminSchedule({ schedule: stored, scheduleSetAt: NOW })).toBe(stored);
  });

  it('⚠ is NOT in force once reset, though the column still holds it', () => {
    expect(adminSchedule({ schedule: stored, scheduleSetAt: null })).toBeNull();
  });
});

describe('a schedule in words', () => {
  it('says an interval in its largest whole unit', () => {
    expect(describeSchedule({ kind: 'interval', everyMinutes: 15 })).toBe('Every 15 minutes');
    expect(describeSchedule({ kind: 'interval', everyMinutes: 60 })).toBe('Every 1 hour');
    expect(describeSchedule({ kind: 'interval', everyMinutes: 90 })).toBe('Every 90 minutes');
    expect(describeMinutes(2880)).toBe('2 days');
  });

  it('says a daily schedule by its times and days', () => {
    expect(describeSchedule({ kind: 'daily', times: ['08:00'], weekdays: EVERY_DAY })).toBe('At 08:00 every day');
    expect(describeSchedule({ kind: 'daily', times: ['17:00', '08:00'], weekdays: [5, 1] })).toBe(
      'At 08:00 and 17:00 on Monday and Friday',
    );
    expect(describeSchedule({ kind: 'daily', times: ['08:00'], weekdays: [1, 2, 3] })).toBe(
      'At 08:00 on Monday, Tuesday and Wednesday',
    );
  });
});

describe('comparing schedules', () => {
  it('puts times and weekdays in order, once each', () => {
    expect(normalizeSchedule({ kind: 'daily', times: ['17:00', '08:00', '08:00'], weekdays: [5, 1, 5] })).toEqual({
      kind: 'daily',
      times: ['08:00', '17:00'],
      weekdays: [1, 5],
    });
  });

  it('calls two the same however they were written, and never across kinds', () => {
    expect(
      isSameSchedule(
        { kind: 'daily', times: ['17:00', '08:00'], weekdays: [1, 0] },
        { kind: 'daily', times: ['08:00', '17:00'], weekdays: [0, 1] },
      ),
    ).toBe(true);
    expect(isSameSchedule({ kind: 'interval', everyMinutes: 15 }, { kind: 'interval', everyMinutes: 30 })).toBe(false);
    expect(
      isSameSchedule({ kind: 'interval', everyMinutes: 15 }, { kind: 'daily', times: ['08:00'], weekdays: [1] }),
    ).toBe(false);
  });
});

describe('why a schedule is refused', () => {
  const limits: ProcessScheduleLimits = { kinds: ['interval', 'daily'], minEveryMinutes: 5 };

  it('⚠ names the limit that was broken', () => {
    expect(scheduleRefusalMessage('interval_too_short', limits)).toBe('This process can run at most every 5 minutes.');
  });

  it('says which kind the process does allow', () => {
    expect(scheduleRefusalMessage('kind_not_allowed', { kinds: ['daily'], minEveryMinutes: 15 })).toMatch(
      /only run at set times of day/u,
    );
    expect(scheduleRefusalMessage('kind_not_allowed', { kinds: ['interval'], minEveryMinutes: 15 })).toMatch(
      /only run every so many minutes/u,
    );
  });
});
