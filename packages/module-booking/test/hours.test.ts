import { fitsOpenWindows, openWindows, prepareBookingException, prepareBookingHours } from '../src/domain/hours.js';

const window = (weekday: number, from: number, to: number) => ({
  weekday,
  startMinute: from * 60,
  endMinute: to * 60,
});

describe('prepareBookingHours', () => {
  it('sorts a week, and keeps a lunch break as two stretches', () => {
    expect(prepareBookingHours([window(1, 13, 17), window(1, 9, 12), window(0, 10, 14)])).toEqual({
      hours: [window(0, 10, 14), window(1, 9, 12), window(1, 13, 17)],
    });
  });

  it('allows stretches that touch', () => {
    expect(prepareBookingHours([window(1, 9, 12), window(1, 12, 17)])).toEqual({
      hours: [window(1, 9, 12), window(1, 12, 17)],
    });
  });

  it('refuses two stretches of one day that overlap', () => {
    expect(prepareBookingHours([window(1, 9, 13), window(1, 12, 17)])).toEqual({ refused: 'invalid_hours' });
  });

  it('refuses a stretch that ends before it starts, or is not on a weekday', () => {
    expect(prepareBookingHours([window(1, 17, 9)])).toEqual({ refused: 'invalid_hours' });
    expect(prepareBookingHours([window(1, 9, 9)])).toEqual({ refused: 'invalid_hours' });
    expect(prepareBookingHours([window(7, 9, 17)])).toEqual({ refused: 'invalid_hours' });
    expect(prepareBookingHours([{ weekday: 1, startMinute: 9.5, endMinute: 600 }])).toEqual({
      refused: 'invalid_hours',
    });
  });

  it('refuses more stretches in a day than a schedule has', () => {
    const many = [0, 1, 2, 3, 4].map((index) => ({
      weekday: 1,
      startMinute: index * 120,
      endMinute: index * 120 + 60,
    }));
    expect(prepareBookingHours(many)).toEqual({ refused: 'invalid_hours' });
  });

  it('takes an empty week: closed every day', () => {
    expect(prepareBookingHours([])).toEqual({ hours: [] });
  });
});

describe('prepareBookingException', () => {
  it('closes a whole day when no minutes are given', () => {
    expect(prepareBookingException({ day: '2026-12-25', note: ' Holiday ' })).toEqual({
      exception: { day: '2026-12-25', startMinute: null, endMinute: null, note: 'Holiday' },
    });
  });

  it('closes a stretch', () => {
    expect(prepareBookingException({ day: '2026-12-24', startMinute: 720, endMinute: 1020 })).toEqual({
      exception: { day: '2026-12-24', startMinute: 720, endMinute: 1020, note: '' },
    });
  });

  it('refuses half a stretch, a backwards one, and a day that is not one', () => {
    expect(prepareBookingException({ day: '2026-12-24', startMinute: 720 })).toEqual({ refused: 'invalid_exception' });
    expect(prepareBookingException({ day: '2026-12-24', startMinute: 720, endMinute: 600 })).toEqual({
      refused: 'invalid_exception',
    });
    expect(prepareBookingException({ day: 'Christmas' })).toEqual({ refused: 'invalid_exception' });
  });
});

describe('openWindows', () => {
  const week = [window(1, 9, 12), window(1, 13, 17), window(2, 9, 17)];

  it('is the weekday’s hours when nothing is closed', () => {
    expect(openWindows(week, 1, [])).toEqual([
      { startMinute: 540, endMinute: 720 },
      { startMinute: 780, endMinute: 1020 },
    ]);
  });

  it('is nothing on a day with no hours', () => {
    expect(openWindows(week, 0, [])).toEqual([]);
  });

  it('⚠ is nothing on a day closed whole', () => {
    expect(openWindows(week, 2, [{ startMinute: null, endMinute: null }])).toEqual([]);
  });

  it('cuts a closed stretch out of the middle, leaving both sides', () => {
    expect(openWindows(week, 2, [{ startMinute: 600, endMinute: 660 }])).toEqual([
      { startMinute: 540, endMinute: 600 },
      { startMinute: 660, endMinute: 1020 },
    ]);
  });

  it('trims an end, and ignores a closure outside the hours', () => {
    expect(
      openWindows(week, 2, [
        { startMinute: 960, endMinute: 1200 },
        { startMinute: 0, endMinute: 300 },
      ]),
    ).toEqual([{ startMinute: 540, endMinute: 960 }]);
  });
});

describe('fitsOpenWindows', () => {
  const open = [
    { startMinute: 540, endMinute: 720 },
    { startMinute: 780, endMinute: 1020 },
  ];

  it('takes a booking that ends exactly at closing', () => {
    expect(fitsOpenWindows(960, 60, open)).toBe(true);
  });

  it('refuses one that runs past closing, or starts before opening', () => {
    expect(fitsOpenWindows(990, 60, open)).toBe(false);
    expect(fitsOpenWindows(510, 60, open)).toBe(false);
  });

  it('⚠ refuses one that runs across the lunch break', () => {
    expect(fitsOpenWindows(690, 120, open)).toBe(false);
  });
});
