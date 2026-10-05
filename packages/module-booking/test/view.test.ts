import { BOOKING_DEFAULT_SETTINGS, prepareBookingSettings } from '../src/domain/catalogue.js';
import {
  asBookingStatus,
  bookingActions,
  changeActor,
  changeText,
  customerInitials,
  dayStats,
  daySummary,
  isSettled,
  resourceKindLabel,
  statusChip,
} from '../src/react/view/day.js';
import {
  addStretch,
  canAddStretch,
  copyToOpenDays,
  dayHoursError,
  dayHoursText,
  removeStretch,
  setStretch,
  toggleDay,
  weekDraft,
  weekSummary,
  weekWindows,
} from '../src/react/view/hours.js';
import { formatPrice, parsePrice, priceInputValue } from '../src/react/view/money.js';
import { bookableDays, customerStatus, cutoffText, publicTimeZone } from '../src/react/view/public.js';
import {
  CUTOFF_OPTIONS,
  customerRulesSummary,
  daysText,
  HORIZON_OPTIONS,
  hoursText,
  isSettingsChanged,
  LAPSE_OPTIONS,
  LEAD_OPTIONS,
  REMINDER_OPTIONS,
  spanText,
  withCurrent,
} from '../src/react/view/settings.js';
import {
  clockTime,
  dayAndTime,
  dayLabel,
  dayText,
  durationText,
  groupByDayPart,
  minutesText,
  minutesToTimeValue,
  timeValueToMinutes,
  weekStrip,
} from '../src/react/view/time.js';

const window = (weekday: number, from: number, to: number) => ({
  weekday,
  startMinute: from * 60,
  endMinute: to * 60,
});

describe('times on screen', () => {
  // 06:30 UTC is 2:30 PM in Manila and 6:30 AM in London.
  const instant = '2031-03-03T06:30:00.000Z';

  it('⚠ prints a booking’s time in the WORKSPACE’s zone, whoever is reading', () => {
    expect(clockTime(instant, 'Asia/Manila')).toBe('2:30 PM');
    expect(clockTime(instant, 'Europe/London')).toBe('6:30 AM');
  });

  it('⚠ prints the day in the workspace’s zone too: late evening in Manila is still that day', () => {
    // 15:30 UTC on the 3rd is 11:30 PM on the 3rd in Manila; 16:30 UTC is 12:30 AM on the 4th.
    expect(dayAndTime('2031-03-03T15:30:00.000Z', 'Asia/Manila')).toBe('Mon, Mar 3, 11:30 PM');
    expect(dayAndTime('2031-03-03T16:30:00.000Z', 'Asia/Manila')).toBe('Tue, Mar 4, 12:30 AM');
  });

  it('prints a day without moving it through anybody’s zone', () => {
    expect(dayText('2031-03-03')).toBe('Monday, March 3, 2031');
    expect(dayText('nonsense')).toBe('nonsense');
  });

  it('names the days around today', () => {
    expect(dayLabel('2031-03-03', '2031-03-03')).toBe('Today');
    expect(dayLabel('2031-03-04', '2031-03-03')).toBe('Tomorrow');
    expect(dayLabel('2031-03-02', '2031-03-03')).toBe('Yesterday');
    expect(dayLabel('2031-03-10', '2031-03-03')).toBe('Mon, Mar 10');
  });

  it('turns minutes of a day into a time field’s value and back', () => {
    expect(minutesToTimeValue(540)).toBe('09:00');
    expect(timeValueToMinutes('09:00')).toBe(540);
    expect(timeValueToMinutes('23:59')).toBe(1439);
    expect(timeValueToMinutes('9am')).toBeNull();
    expect(timeValueToMinutes('12:75')).toBeNull();
  });

  it('reads minutes of a day aloud', () => {
    expect([minutesText(0), minutesText(540), minutesText(720), minutesText(1020), minutesText(1440)]).toEqual([
      '12:00 AM',
      '9:00 AM',
      '12:00 PM',
      '5:00 PM',
      'midnight',
    ]);
  });

  it('says how long a service takes', () => {
    expect([durationText(30), durationText(60), durationText(90), durationText(120)]).toEqual([
      '30 min',
      '1 hr',
      '1 hr 30 min',
      '2 hr',
    ]);
  });
});

describe('a booking on the day list', () => {
  const everything = { manage: true, cancel: true };
  const started = new Date('2031-03-03T02:30:00Z');
  const notYet = new Date('2031-03-03T01:00:00Z');
  const at = { startsAt: '2031-03-03T02:00:00.000Z' };

  it('marks a request as the one thing waiting for the desk', () => {
    expect(statusChip('pending')).toEqual({ label: 'Waiting to be confirmed', tone: 'warning' });
  });

  it('shows a status it does not know as it came, never hides it', () => {
    expect(statusChip('on_hold')).toEqual({ label: 'on_hold', tone: 'neutral' });
    expect(asBookingStatus('on_hold')).toBeNull();
  });

  it('offers a confirmed booking its next steps', () => {
    expect(bookingActions({ status: 'confirmed', ...at }, everything, started)).toEqual({
      confirm: false,
      decline: false,
      arrive: true,
      finish: true,
      noShow: true,
      reschedule: true,
      editDetails: true,
      cancel: true,
    });
  });

  it('⚠ does not offer a no-show before the booking’s time has come', () => {
    expect(bookingActions({ status: 'confirmed', ...at }, everything, notYet).noShow).toBe(false);
  });

  it('offers a request only confirm, decline, move, correct and cancel', () => {
    const actions = bookingActions({ status: 'pending', ...at }, everything, started);
    expect([actions.confirm, actions.decline, actions.reschedule, actions.cancel]).toEqual([true, true, true, true]);
    expect([actions.arrive, actions.finish, actions.noShow]).toEqual([false, false, false]);
  });

  it('⚠ offers nothing on a booking that is over', () => {
    for (const status of ['done', 'cancelled', 'declined', 'no_show']) {
      expect(Object.values(bookingActions({ status, ...at }, everything, started)).some(Boolean)).toBe(false);
      expect(isSettled(status)).toBe(true);
    }
  });

  it('⚠ offers cancelling only to somebody holding its key, and nothing to somebody holding neither', () => {
    const desk = bookingActions({ status: 'confirmed', ...at }, { manage: true, cancel: false }, started);
    expect([desk.arrive, desk.cancel]).toEqual([true, false]);
    const reader = bookingActions({ status: 'confirmed', ...at }, { manage: false, cancel: false }, started);
    expect(Object.values(reader).some(Boolean)).toBe(false);
  });

  it('counts the bookings still live, and the requests waiting', () => {
    const statuses = ['confirmed', 'pending', 'arrived', 'cancelled', 'done', 'pending'];
    expect(daySummary(statuses.map((status) => ({ status })))).toEqual({ live: 4, waiting: 2 });
  });

  it('says what was done and by whom', () => {
    expect(changeText('rescheduled')).toBe('Moved');
    expect(changeText('something_new')).toBe('something_new');
    expect(changeActor({ actorKind: 'staff', actorName: 'Ana' })).toBe('Ana');
    expect(changeActor({ actorKind: 'staff', actorName: null })).toBe('a former member');
    expect(changeActor({ actorKind: 'customer', actorName: null })).toBe('the customer');
    expect(changeActor({ actorKind: 'system', actorName: null })).toBe('the app');
  });

  it('names a resource’s kind generically', () => {
    expect([resourceKindLabel('staff'), resourceKindLabel('place'), resourceKindLabel('equipment')]).toEqual([
      'Staff',
      'Place',
      'Equipment',
    ]);
  });
});

describe('the hours editor', () => {
  const week = [window(1, 9, 12), window(1, 13, 17), window(2, 9, 17)];

  it('holds the week as seven rows, Monday first, and gives back what it was given', () => {
    const draft = weekDraft(week);
    expect(draft.map((day) => day.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(weekWindows(draft)).toEqual(week);
  });

  it('opens a closed day nine to five, and closes an open one', () => {
    const opened = toggleDay(weekDraft([]), 3);
    expect(weekWindows(opened)).toEqual([window(3, 9, 17)]);
    expect(weekWindows(toggleDay(opened, 3))).toEqual([]);
  });

  it('adds a stretch after the last one, with a key no other row of the day has', () => {
    const draft = addStretch(weekDraft([window(1, 9, 12)]), 1);
    const monday = draft.find((day) => day.weekday === 1);
    expect(weekWindows(draft)).toEqual([window(1, 9, 12), window(1, 13, 17)]);
    expect(new Set(monday?.stretches.map((stretch) => stretch.key)).size).toBe(2);
  });

  it('⚠ keeps a row’s key when another row is removed, so the field being typed in is not remounted', () => {
    const draft = addStretch(addStretch(weekDraft([window(1, 8, 9)]), 1), 1);
    const keys = draft.find((day) => day.weekday === 1)?.stretches.map((stretch) => stretch.key) ?? [];
    const [first, , last] = keys;
    const after = removeStretch(draft, 1, keys[1] ?? '');
    expect(after.find((day) => day.weekday === 1)?.stretches.map((stretch) => stretch.key)).toEqual([first, last]);
    // And a key freed by a removal is not handed to the next row while its neighbours still hold theirs.
    const again = addStretch(after, 1);
    const againKeys = again.find((day) => day.weekday === 1)?.stretches.map((stretch) => stretch.key) ?? [];
    expect(new Set(againKeys).size).toBe(againKeys.length);
  });

  it('stops offering another stretch at four, or when the day has run out', () => {
    let draft = weekDraft([window(1, 0, 1)]);
    for (let i = 0; i < 5; i += 1) draft = addStretch(draft, 1);
    expect(draft.find((day) => day.weekday === 1)?.stretches).toHaveLength(4);
    const lateDay = weekDraft([window(1, 9, 24)]).find((day) => day.weekday === 1);
    expect(lateDay ? canAddStretch(lateDay) : true).toBe(false);
  });

  it('changes one stretch’s times', () => {
    const draft = weekDraft([window(1, 9, 17)]);
    const key = draft.find((day) => day.weekday === 1)?.stretches[0]?.key ?? '';
    expect(weekWindows(setStretch(draft, 1, key, { endMinute: 18 * 60 }))).toEqual([window(1, 9, 18)]);
  });

  it('copies one day’s hours to the other OPEN days, and leaves closed days closed', () => {
    const draft = copyToOpenDays(weekDraft([window(1, 8, 16), window(2, 9, 17)]), 1);
    expect(weekWindows(draft)).toEqual([window(1, 8, 16), window(2, 8, 16)]);
  });

  it('says what is wrong with a day before it is saved', () => {
    const [backwards] = weekDraft([{ weekday: 1, startMinute: 600, endMinute: 540 }]);
    const [overlapping] = weekDraft([window(1, 9, 13), window(1, 12, 17)]);
    const [fine] = weekDraft([window(1, 9, 12), window(1, 12, 17)]);
    expect(backwards ? dayHoursError(backwards) : null).toBe('A stretch must end after it starts.');
    expect(overlapping ? dayHoursError(overlapping) : null).toBe('These stretches overlap.');
    expect(fine ? dayHoursError(fine) : 'missing').toBeNull();
  });

  it('prints a day’s hours, and a closed day', () => {
    expect(dayHoursText([{ startMinute: 540, endMinute: 720 }])).toBe('9:00 AM – 12:00 PM');
    expect(dayHoursText([])).toBe('Closed');
  });

  it('summarises a week by grouping days with the same hours', () => {
    const weekdays = [1, 2, 3, 4, 5].map((weekday) => window(weekday, 9, 17));
    expect(weekSummary([...weekdays, window(6, 9, 12)])).toBe('Mon–Fri 9:00 AM – 5:00 PM · Sat 9:00 AM – 12:00 PM');
  });

  it('⚠ says plainly that a resource with no hours cannot be booked', () => {
    expect(weekSummary([])).toBe('No opening hours yet — it cannot be booked.');
  });
});

describe('a price', () => {
  it('prints centavos as pesos', () => {
    expect(formatPrice(150000)).toBe('₱1,500.00');
  });

  it('⚠ parses the text, never through a float', () => {
    expect(parsePrice('0.29')).toBe(29);
    expect(parsePrice('1,500.5')).toBe(150050);
    expect(parsePrice('₱1,500')).toBe(150000);
  });

  it('refuses a third decimal, a negative and a word', () => {
    expect([parsePrice('1.005'), parsePrice('-5'), parsePrice('free')]).toEqual([null, null, null]);
  });

  it('starts an input from what is stored, and empty when there is no price', () => {
    expect([priceInputValue(150000), priceInputValue(null)]).toEqual(['1500.00', '']);
  });
});

describe('the day at a glance', () => {
  it('counts what is to come, waiting, here and done — and leaves out what is off', () => {
    const statuses = ['confirmed', 'confirmed', 'pending', 'arrived', 'done', 'cancelled', 'no_show', 'declined'];
    expect(dayStats(statuses.map((status) => ({ status })))).toEqual({ upcoming: 2, waiting: 1, arrived: 1, done: 1 });
  });

  it('makes a badge of a customer’s initials, and never an empty one', () => {
    expect([
      customerInitials('Maria Santos'),
      customerInitials('  maria  de la cruz '),
      customerInitials('Cher'),
    ]).toEqual(['MS', 'MC', 'C']);
    expect(customerInitials('   ')).toBe('?');
  });
});

describe('the week strip', () => {
  it('is the seven days of the selected day’s week, Monday first', () => {
    // 5 March 2031 is a Wednesday.
    const strip = weekStrip('2031-03-05', '2031-03-03');
    expect(strip.map((entry) => entry.day)).toEqual([
      '2031-03-03',
      '2031-03-04',
      '2031-03-05',
      '2031-03-06',
      '2031-03-07',
      '2031-03-08',
      '2031-03-09',
    ]);
    expect(strip.map((entry) => entry.weekday)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(strip.filter((entry) => entry.isSelected).map((entry) => entry.dayOfMonth)).toEqual(['5']);
    expect(strip.filter((entry) => entry.isToday).map((entry) => entry.day)).toEqual(['2031-03-03']);
  });

  it('⚠ puts a Sunday at the END of its week, not the start of the next', () => {
    expect(weekStrip('2031-03-09', '2031-03-09').at(-1)?.day).toBe('2031-03-09');
    expect(weekStrip('2031-03-09', '2031-03-09')[0]?.day).toBe('2031-03-03');
  });

  it('crosses a month', () => {
    expect(weekStrip('2031-03-01', '2031-03-01').map((entry) => entry.dayOfMonth)).toEqual([
      '24',
      '25',
      '26',
      '27',
      '28',
      '1',
      '2',
    ]);
  });
});

describe('free times by part of the day', () => {
  // 01:00, 04:30 and 10:00 UTC are 9:00 AM, 12:30 PM and 6:00 PM in Manila.
  const starts = ['2031-03-03T01:00:00.000Z', '2031-03-03T04:30:00.000Z', '2031-03-03T10:00:00.000Z'];

  it('⚠ groups by the WORKSPACE’s clock, not the reader’s', () => {
    expect(groupByDayPart(starts, 'Asia/Manila').map((group) => [group.part, group.starts.length])).toEqual([
      ['Morning', 1],
      ['Afternoon', 1],
      ['Evening', 1],
    ]);
    // In London the same three instants are 1:00 AM, 4:30 AM and 10:00 AM: all morning.
    expect(groupByDayPart(starts, 'Europe/London').map((group) => [group.part, group.starts.length])).toEqual([
      ['Morning', 3],
    ]);
  });

  it('leaves out a part of the day with nothing free', () => {
    expect(groupByDayPart(starts.slice(0, 1), 'Asia/Manila').map((group) => group.part)).toEqual(['Morning']);
    expect(groupByDayPart([], 'Asia/Manila')).toEqual([]);
  });
});

describe('what a customer reads', () => {
  it('⚠ a request is "waiting to be confirmed", never "booked" (D2)', () => {
    const waiting = customerStatus('pending', '');
    expect(waiting.label).toBe('Waiting to be confirmed');
    expect(waiting.explain).toContain('We will confirm it');
    expect(waiting.explain).not.toMatch(/you are booked/iu);
    expect(customerStatus('confirmed', '').explain).toContain('You are booked');
  });

  it('says why a request was not taken, when the shop said — and when the app let it lapse', () => {
    expect(customerStatus('declined', 'Not confirmed in time').explain).toContain('Not confirmed in time.');
    expect(customerStatus('declined', '').label).toBe('Not confirmed');
    expect(customerStatus('cancelled', 'Change of plans').explain).toBe('This booking was cancelled. Change of plans.');
  });

  it('shows a status it does not know as it came', () => {
    expect(customerStatus('on_hold', '').label).toBe('on_hold');
  });

  it('⚠ prints in the shop’s zone, and never trusts one it cannot check', () => {
    expect(publicTimeZone('Europe/London')).toBe('Europe/London');
    expect(publicTimeZone('Mars/Olympus')).toBe('Asia/Manila');
    expect(publicTimeZone(null)).toBe('Asia/Manila');
  });

  it('says until when a booking can be changed', () => {
    expect([cutoffText(0), cutoffText(120), cutoffText(1440), cutoffText(2880)]).toEqual([
      'until it starts',
      'up to 2 hr before',
      'up to 1 day before',
      'up to 2 days before',
    ]);
  });

  it('offers the days from today to the horizon, and no further', () => {
    expect(bookableDays('2031-03-03', '2031-03-05')).toEqual(['2031-03-03', '2031-03-04', '2031-03-05']);
    expect(bookableDays('2031-03-03', '2031-12-31')).toHaveLength(14);
    expect(bookableDays('2031-03-03', '2031-03-02')).toEqual([]);
  });
});

describe('the settings screen’s choices', () => {
  it('says a length in the words a person would', () => {
    expect([spanText(30), spanText(60), spanText(1440), spanText(2880), spanText(1500)]).toEqual([
      '30 min',
      '1 hr',
      '1 day',
      '2 days',
      '25 hr',
    ]);
    expect([daysText(1), daysText(7), daysText(14), daysText(30), daysText(365)]).toEqual([
      '1 day',
      '1 week',
      '2 weeks',
      '30 days',
      '1 year',
    ]);
    expect([hoursText(1), hoursText(12), hoursText(24), hoursText(168)]).toEqual([
      '1 hour',
      '12 hours',
      '1 day',
      '7 days',
    ]);
  });

  it('offers "off" as a choice, not as a zero', () => {
    expect(REMINDER_OPTIONS[0]).toEqual({ value: 0, label: 'Off — no reminder' });
    expect(LEAD_OPTIONS[0]?.label).toBe('No notice needed');
    expect(CUTOFF_OPTIONS[0]?.label).toBe('Right up to the start');
  });

  it('⚠ every preset is a value the domain accepts, and the defaults are among them', () => {
    const lists = {
      reminderMinutes: REMINDER_OPTIONS,
      leadMinutes: LEAD_OPTIONS,
      horizonDays: HORIZON_OPTIONS,
      cutoffMinutes: CUTOFF_OPTIONS,
      lapseHours: LAPSE_OPTIONS,
    } as const;
    for (const [key, list] of Object.entries(lists)) {
      const field = key as keyof typeof lists;
      expect([key, list.some((option) => option.value === BOOKING_DEFAULT_SETTINGS[field])]).toEqual([key, true]);
      for (const option of list) {
        const prepared = prepareBookingSettings({ ...BOOKING_DEFAULT_SETTINGS, [field]: option.value });
        expect([key, option.value, 'settings' in prepared]).toEqual([key, option.value, true]);
      }
    }
  });

  it('⚠ still offers a stored value that is not a preset, in its place — never shows another in its stead', () => {
    const list = withCurrent(REMINDER_OPTIONS, 45, (minutes) => `${spanText(minutes)} before`);
    expect(list.map((option) => option.value)).toEqual([0, 5, 10, 15, 30, 45, 60, 120, 1440]);
    expect(list.find((option) => option.value === 45)?.label).toBe('45 min before');
    expect(withCurrent(REMINDER_OPTIONS, 15, String)).toEqual([...REMINDER_OPTIONS]);
  });

  it('knows when the form holds something unsaved, and that a trailing space is not it', () => {
    const stored = { ...BOOKING_DEFAULT_SETTINGS, publicTitle: 'Ana’s Shop' };
    expect(isSettingsChanged(stored, stored)).toBe(false);
    expect(isSettingsChanged({ ...stored, publicTitle: 'Ana’s Shop  ' }, stored)).toBe(false);
    expect(isSettingsChanged({ ...stored, slotMinutes: 15 }, stored)).toBe(true);
    expect(isSettingsChanged({ ...stored, publicEnabled: true }, stored)).toBe(true);
  });

  it('reads the customer’s rules back as one sentence', () => {
    expect(customerRulesSummary(BOOKING_DEFAULT_SETTINGS)).toBe(
      'Customers can ask for from 1 hr ahead, up to 30 days ahead, and cancel or change it themselves until 2 hr before. ' +
        'A request you do not answer lapses after 1 day.',
    );
    expect(customerRulesSummary({ leadMinutes: 0, horizonDays: 7, cutoffMinutes: 0, lapseHours: 4 })).toBe(
      'Customers can ask for any time still ahead, up to 1 week ahead, and cancel or change it themselves right up to the start. ' +
        'A request you do not answer lapses after 4 hours.',
    );
  });
});
