import {
  addDays,
  isScheduledAfterDue,
  isTaskDueSoon,
  isTaskOverdue,
  prepareTaskDay,
  taskAttention,
  taskDayFromDate,
  taskDayGroup,
  taskDayToDate,
  workspaceTaskDay,
} from '../src/domain/dates.js';

describe('prepareTaskDay', () => {
  it('accepts a real day, and no date at all', () => {
    expect(prepareTaskDay('2026-10-05')).toEqual({ day: '2026-10-05' });
    expect(prepareTaskDay(null)).toEqual({ day: null });
    expect(prepareTaskDay('')).toEqual({ day: null });
  });

  it('⚠ refuses a day that does not exist rather than rolling it over', () => {
    expect(prepareTaskDay('2026-02-30')).toEqual({ refused: 'invalid_date' });
    expect(prepareTaskDay('2026-13-01')).toEqual({ refused: 'invalid_date' });
    expect(prepareTaskDay('5 Oct')).toEqual({ refused: 'invalid_date' });
    expect(prepareTaskDay('2026-10-05T10:00:00Z')).toEqual({ refused: 'invalid_date' });
  });
});

describe('the DATE column round trip', () => {
  it('⚠ keeps the same day whatever the process time zone', () => {
    expect(taskDayFromDate(taskDayToDate('2026-10-05'))).toBe('2026-10-05');
    expect(taskDayFromDate(null)).toBeNull();
  });
});

describe('workspaceTaskDay', () => {
  it('⚠ is the WORKSPACE’s day, whoever reads it — 11:30 PM in Manila is still that day', () => {
    const late = new Date('2026-10-05T15:30:00Z'); // 23:30 in Manila, 00:30 the next day in Tokyo
    expect(workspaceTaskDay(late, 'Asia/Manila')).toBe('2026-10-05');
    expect(workspaceTaskDay(late, 'Asia/Tokyo')).toBe('2026-10-06');
  });
});

describe('overdue, and scheduled after due', () => {
  it('is overdue only when unfinished and due before today', () => {
    expect(isTaskOverdue({ dueOn: '2026-10-04', completed: false }, '2026-10-05')).toBe(true);
    expect(isTaskOverdue({ dueOn: '2026-10-05', completed: false }, '2026-10-05')).toBe(false);
    expect(isTaskOverdue({ dueOn: '2026-10-04', completed: true }, '2026-10-05')).toBe(false);
    expect(isTaskOverdue({ dueOn: null, completed: false }, '2026-10-05')).toBe(false);
  });

  it('warns when scheduled after it is due, never when either is missing', () => {
    expect(isScheduledAfterDue({ scheduledOn: '2026-10-06', dueOn: '2026-10-05' })).toBe(true);
    expect(isScheduledAfterDue({ scheduledOn: '2026-10-05', dueOn: '2026-10-05' })).toBe(false);
    expect(isScheduledAfterDue({ scheduledOn: null, dueOn: '2026-10-05' })).toBe(false);
  });
});

describe('taskDayGroup', () => {
  const today = '2026-10-05';
  it('puts overdue first, then groups by scheduled day, else due day', () => {
    expect(taskDayGroup({ scheduledOn: '2026-10-09', dueOn: '2026-10-01', completed: false }, today)).toBe('overdue');
    expect(taskDayGroup({ scheduledOn: today, dueOn: '2026-12-01', completed: false }, today)).toBe('today');
    expect(taskDayGroup({ scheduledOn: '2026-10-03', dueOn: null, completed: false }, today)).toBe('today');
    expect(taskDayGroup({ scheduledOn: null, dueOn: '2026-10-11', completed: false }, today)).toBe('this_week');
    expect(taskDayGroup({ scheduledOn: null, dueOn: '2026-10-12', completed: false }, today)).toBe('later');
    expect(taskDayGroup({ scheduledOn: null, dueOn: null, completed: false }, today)).toBe('no_date');
  });

  it('adds calendar days across a month end', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
  });
});

describe('taskAttention', () => {
  const today = '2026-10-05';
  const task = (scheduledOn: string | null, dueOn: string | null, completed = false) => ({
    scheduledOn,
    dueOn,
    completed,
  });

  it('counts overdue, today and soon, as My tasks groups them', () => {
    expect(
      taskAttention(
        [
          task(null, '2026-10-04'), // overdue
          task('2026-10-01', '2026-10-09'), // planned earlier, not yet due: today
          task(null, '2026-10-05'), // due today
          task('2026-10-08', null), // planned in three days: soon
          task(null, '2026-10-09'), // four days out: nothing
          task(null, null), // no date: nothing
        ],
        today,
      ),
    ).toEqual({ overdue: 1, today: 2, soon: 1 });
  });

  it('counts a nearing deadline as soon even when planned for after it', () => {
    expect(taskAttention([task('2026-10-20', '2026-10-07')], today)).toEqual({ overdue: 0, today: 0, soon: 1 });
  });

  it('⚠ never counts finished work', () => {
    expect(taskAttention([task(null, '2026-10-01', true), task(null, '2026-10-05', true)], today)).toEqual({
      overdue: 0,
      today: 0,
      soon: 0,
    });
  });
});

describe('isTaskDueSoon', () => {
  it('is due today or within three days, unfinished', () => {
    expect(isTaskDueSoon({ dueOn: '2026-10-05', completed: false }, '2026-10-05')).toBe(true);
    expect(isTaskDueSoon({ dueOn: '2026-10-08', completed: false }, '2026-10-05')).toBe(true);
    expect(isTaskDueSoon({ dueOn: '2026-10-09', completed: false }, '2026-10-05')).toBe(false);
    expect(isTaskDueSoon({ dueOn: '2026-10-04', completed: false }, '2026-10-05')).toBe(false);
    expect(isTaskDueSoon({ dueOn: '2026-10-06', completed: true }, '2026-10-05')).toBe(false);
  });
});
