import { ModuleCompositionError } from '../src/compose.js';
import {
  checkProcessSchedule,
  composeProcesses,
  effectiveProcessSchedule,
  type ProcessDeclaration,
  type ProcessSchedule,
  processCadenceMinutes,
  processOccurrence,
} from '../src/processes.js';
import { zonedMinuteOfDay, zonedWeekday } from '../src/time-zone.js';

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const AT_EIGHT: ProcessSchedule = { kind: 'daily', times: ['08:00'], weekdays: EVERY_DAY };

function declaration(overrides: Partial<ProcessDeclaration> = {}): ProcessDeclaration {
  return {
    key: 'task.due_today',
    module: 'task',
    label: 'Task due reminders',
    description: 'Tells people what is due today.',
    serves: 'task:read',
    defaultSchedule: AT_EIGHT,
    scheduleLimits: { kinds: ['daily', 'interval'], minEveryMinutes: 15 },
    maxRunSeconds: 60,
    maxItemsPerRun: 100,
    tooLateAfterMinutes: 120,
    ...overrides,
  };
}

describe('composing processes', () => {
  it('collects every module’s, and keeps whatever else each entry carries', () => {
    const handler = { run: async () => ({ handled: 0, skippedLate: 0, leftForNext: 0 }) };
    const composed = composeProcesses([{ key: 'task', processes: [{ ...declaration(), handler }] }, { key: 'note' }]);
    expect(composed.map((process) => process.key)).toEqual(['task.due_today']);
    expect(composed[0]?.handler).toBe(handler);
  });

  it('refuses one key declared twice', () => {
    expect(() =>
      composeProcesses([
        { key: 'task', processes: [declaration()] },
        { key: 'other', processes: [declaration()] },
      ]),
    ).toThrow(ModuleCompositionError);
  });

  it('⚠ refuses a process that leaves a limit unsaid', () => {
    const missing = (overrides: object) => () =>
      composeProcesses([{ key: 'task', processes: [{ ...declaration(), ...overrides } as ProcessDeclaration] }]);
    expect(missing({ maxRunSeconds: undefined })).toThrow(/maxRunSeconds/u);
    expect(missing({ maxItemsPerRun: 0 })).toThrow(/maxItemsPerRun/u);
    expect(missing({ tooLateAfterMinutes: undefined })).toThrow(/tooLateAfterMinutes/u);
    expect(missing({ scheduleLimits: undefined })).toThrow(/scheduleLimits/u);
  });

  it('⚠ refuses a process that does not say what it serves, and accepts a written null', () => {
    const compose = (serves: unknown) => () =>
      composeProcesses([{ key: 'task', processes: [{ ...declaration(), serves } as ProcessDeclaration] }]);
    expect(compose(undefined)).toThrow(/serves/u);
    expect(compose('pos:read')).toThrow(/own module/u);
    expect(compose(null)).not.toThrow();
  });

  it('refuses a key outside its module, and a default that breaks its own limits', () => {
    expect(() => composeProcesses([{ key: 'task', processes: [declaration({ key: 'pos.carts' })] }])).toThrow(
      /task\.<what>/u,
    );
    expect(() =>
      composeProcesses([
        { key: 'task', processes: [declaration({ defaultSchedule: { kind: 'interval', everyMinutes: 5 } })] },
      ]),
    ).toThrow(/interval_too_short/u);
  });
});

describe('a schedule against a process’s limits', () => {
  const limits = declaration().scheduleLimits;

  it('allows what fits', () => {
    expect(checkProcessSchedule({ kind: 'interval', everyMinutes: 15 }, limits)).toBeNull();
    expect(checkProcessSchedule({ kind: 'daily', times: ['08:00', '13:30'], weekdays: [1, 5] }, limits)).toBeNull();
  });

  it('refuses each way of not fitting, by name', () => {
    expect(checkProcessSchedule({ kind: 'interval', everyMinutes: 14 }, limits)).toBe('interval_too_short');
    expect(checkProcessSchedule({ kind: 'interval', everyMinutes: 1.5 }, limits)).toBe('malformed');
    expect(checkProcessSchedule(AT_EIGHT, { kinds: ['interval'], minEveryMinutes: 15 })).toBe('kind_not_allowed');
    expect(checkProcessSchedule({ kind: 'daily', times: [], weekdays: [1] }, limits)).toBe('no_times');
    expect(checkProcessSchedule({ kind: 'daily', times: ['8:00'], weekdays: [1] }, limits)).toBe('invalid_time');
    expect(checkProcessSchedule({ kind: 'daily', times: ['24:00'], weekdays: [1] }, limits)).toBe('invalid_time');
    expect(checkProcessSchedule({ kind: 'daily', times: ['08:00'], weekdays: [] }, limits)).toBe('no_weekdays');
    expect(checkProcessSchedule({ kind: 'daily', times: ['08:00'], weekdays: [7] }, limits)).toBe('invalid_weekday');
  });
});

describe('the schedule in force', () => {
  it('is the default until an admin sets one', () => {
    expect(effectiveProcessSchedule(declaration(), null)).toEqual({ schedule: AT_EIGHT, overrideIgnored: false });
  });

  it('is the admin’s while it fits', () => {
    const override = { kind: 'interval', everyMinutes: 60 };
    expect(effectiveProcessSchedule(declaration(), override)).toEqual({ schedule: override, overrideIgnored: false });
  });

  it('⚠ falls back to the default, and says so, when the limits were tightened under it', () => {
    const tightened = declaration({ scheduleLimits: { kinds: ['daily'], minEveryMinutes: 15 } });
    expect(effectiveProcessSchedule(tightened, { kind: 'interval', everyMinutes: 60 })).toEqual({
      schedule: AT_EIGHT,
      overrideIgnored: true,
    });
    expect(effectiveProcessSchedule(declaration(), 'every hour').overrideIgnored).toBe(true);
  });

  it('sweeps a daily schedule at the process’s shortest interval', () => {
    const limits = declaration().scheduleLimits;
    expect(processCadenceMinutes(AT_EIGHT, limits)).toBe(15);
    expect(processCadenceMinutes({ kind: 'interval', everyMinutes: 90 }, limits)).toBe(90);
  });
});

describe('whether a process’s time has come in a workspace', () => {
  // 00:10 UTC on Monday 5 Oct 2026: 08:10 that Monday in Manila, 20:10 on SUNDAY the 4th in New York.
  const now = new Date('2026-10-05T00:10:00Z');

  it('⚠ reads the day, the weekday and the minute in the workspace’s zone', () => {
    expect(zonedMinuteOfDay(now, 'Asia/Manila')).toBe(8 * 60 + 10);
    expect(zonedWeekday(now, 'Asia/Manila')).toBe(1);
    expect(zonedMinuteOfDay(now, 'America/New_York')).toBe(20 * 60 + 10);
    expect(zonedWeekday(now, 'America/New_York')).toBe(0);
  });

  it('⚠ is due in Manila at its 8:00 and already too late in New York, at one instant', () => {
    expect(processOccurrence(AT_EIGHT, now, 'Asia/Manila', 120)).toEqual({ kind: 'due', dayKey: '2026-10-05' });
    expect(processOccurrence(AT_EIGHT, now, 'America/New_York', 120)).toEqual({
      kind: 'too_late',
      dayKey: '2026-10-04',
    });
  });

  it('has not come before the time, and is too late past the window', () => {
    expect(processOccurrence(AT_EIGHT, new Date('2026-10-04T23:59:00Z'), 'Asia/Manila', 120)).toEqual({ kind: 'none' });
    // 10:00 in Manila is exactly the window's edge; 10:01 is past it.
    expect(processOccurrence(AT_EIGHT, new Date('2026-10-05T02:00:00Z'), 'Asia/Manila', 120).kind).toBe('due');
    expect(processOccurrence(AT_EIGHT, new Date('2026-10-05T02:01:00Z'), 'Asia/Manila', 120).kind).toBe('too_late');
  });

  it('skips a weekday that was not chosen, by the workspace’s own calendar', () => {
    const weekdaysOnly: ProcessSchedule = { kind: 'daily', times: ['08:00'], weekdays: [1, 2, 3, 4, 5] };
    expect(processOccurrence(weekdaysOnly, now, 'Asia/Manila', 900).kind).toBe('due');
    // Still Sunday in New York, however late in the day.
    expect(processOccurrence(weekdaysOnly, now, 'America/New_York', 900)).toEqual({ kind: 'none' });
  });

  it('measures lateness from the latest time that has come, so a second time is a second chance', () => {
    const twice: ProcessSchedule = { kind: 'daily', times: ['08:00', '14:00'], weekdays: EVERY_DAY };
    // 13:00 in Manila: the 8:00 window has closed. 14:05: the 14:00 one is open.
    expect(processOccurrence(twice, new Date('2026-10-05T05:00:00Z'), 'Asia/Manila', 120).kind).toBe('too_late');
    expect(processOccurrence(twice, new Date('2026-10-05T06:05:00Z'), 'Asia/Manila', 120).kind).toBe('due');
  });

  it('is always due on an interval, for the workspace’s own today', () => {
    const hourly: ProcessSchedule = { kind: 'interval', everyMinutes: 60 };
    expect(processOccurrence(hourly, now, 'America/New_York', 120)).toEqual({ kind: 'due', dayKey: '2026-10-04' });
  });
});
