import {
  actorLabel,
  agoText,
  checkScheduleDraft,
  controlSummary,
  groupByModule,
  historySignature,
  moduleLabel,
  queuePositionText,
  runDurationText,
  runSummary,
  runTitle,
  scheduleDraftOf,
  scheduleNote,
  scheduleOfDraft,
  scheduleText,
  standingChip,
  standingDetail,
  summarizeProcesses,
  untilText,
  whenText,
} from '../src/react/view/jobs-view.js';

const EVERY_15 = { kind: 'interval', everyMinutes: 15, times: [], weekdays: [] };
const DAILY_8 = { kind: 'daily', everyMinutes: null, times: ['08:00'], weekdays: [0, 1, 2, 3, 4, 5, 6] };

const run = (over: Partial<Parameters<typeof runSummary>[0]> = {}) => ({
  trigger: 'scheduled',
  forcedByName: null,
  state: 'succeeded',
  queuedAt: '2026-10-05T00:00:00.000Z',
  startedAt: '2026-10-05T00:00:00.000Z',
  finishedAt: '2026-10-05T00:00:12.000Z',
  handled: 0,
  skippedLate: 0,
  leftForNext: 0,
  note: null,
  error: null,
  ...over,
});

const process = (over: Partial<Parameters<typeof standingDetail>[0]> = {}) => ({
  module: 'task',
  standing: 'idle',
  queuePosition: null,
  pausedByName: null,
  pauseReason: null,
  failingError: null,
  ...over,
});

describe('grouping by module', () => {
  it('uses the app’s names where it gave them, and the key in words otherwise', () => {
    expect(moduleLabel('task', { task: 'Tasks' })).toBe('Tasks');
    expect(moduleLabel('basic_pos')).toBe('Basic pos');
  });

  it('puts each process under its module, headings in order', () => {
    const groups = groupByModule(
      [
        { key: 'task.due_today', module: 'task' },
        { key: 'booking.reminders', module: 'booking' },
        { key: 'task.cleanup', module: 'task' },
      ],
      { task: 'Tasks', booking: 'Booking' },
    );

    expect(groups.map((group) => [group.label, group.processes.map((one) => one.key)])).toEqual([
      ['Booking', ['booking.reminders']],
      ['Tasks', ['task.due_today', 'task.cleanup']],
    ]);
  });
});

describe('the numbers at the top of the page', () => {
  it('counts what somebody might need to act on', () => {
    const standings = ['idle', 'idle', 'queued', 'running', 'paused', 'failing', 'unsynced'];
    expect(summarizeProcesses(standings.map((standing) => ({ standing })))).toEqual({
      total: 7,
      active: 2,
      paused: 1,
      failing: 1,
    });
    expect(summarizeProcesses([])).toEqual({ total: 0, active: 0, paused: 0, failing: 0 });
  });
});

describe('how a process stands, in words', () => {
  it('has a chip for every standing, and never dresses an unknown one as fine', () => {
    expect(standingChip('idle')).toEqual({ label: 'On schedule', tone: 'success' });
    expect(standingChip('failing').tone).toBe('danger');
    expect(standingChip('paused').tone).toBe('warning');
    expect(standingChip('something_new')).toEqual({ label: 'something_new', tone: 'warning' });
  });

  it('says who paused it and why', () => {
    expect(
      standingDetail(process({ standing: 'paused', pausedByName: 'Ana Cruz', pauseReason: 'Mail is down.' })),
    ).toBe('Paused by Ana Cruz — Mail is down.');
    expect(standingDetail(process({ standing: 'paused' }))).toBe('Paused by an administrator');
  });

  it('says where it is in the queue', () => {
    expect(queuePositionText(1)).toBe('Next in the queue');
    expect(queuePositionText(2)).toBe('Second in the queue');
    expect(queuePositionText(9)).toBe('Number 9 in the queue');
    expect(standingDetail(process({ standing: 'queued', queuePosition: 2 }))).toBe('Second in the queue');
  });

  it('⚠ says a failing process plainly, with its last error', () => {
    expect(standingDetail(process({ standing: 'failing', failingError: 'The mail server refused.' }))).toBe(
      'Its last run failed: The mail server refused.',
    );
  });

  it('says what to do about one never synced, and nothing about one just waiting', () => {
    expect(standingDetail(process({ standing: 'unsynced' }))).toMatch(/db:sync/u);
    expect(standingDetail(process())).toBeNull();
  });
});

describe('when the open history is read again', () => {
  const quiet = { activeRun: null, lastRun: { id: 'run-1' }, pausedAt: null, scheduleSetAt: null };

  it('⚠ only when something that writes history has happened', () => {
    const before = historySignature(quiet);

    expect(historySignature({ ...quiet })).toBe(before);
    expect(historySignature({ ...quiet, activeRun: { id: 'run-2', state: 'queued' } })).not.toBe(before);
    expect(historySignature({ ...quiet, lastRun: { id: 'run-2' } })).not.toBe(before);
    expect(historySignature({ ...quiet, pausedAt: '2026-10-05T00:00:00.000Z' })).not.toBe(before);
    expect(historySignature({ ...quiet, scheduleSetAt: '2026-10-05T00:00:00.000Z' })).not.toBe(before);
  });

  it('tells a queued run from the same run started', () => {
    expect(historySignature({ ...quiet, activeRun: { id: 'run-2', state: 'queued' } })).not.toBe(
      historySignature({ ...quiet, activeRun: { id: 'run-2', state: 'running' } }),
    );
  });
});

describe('a schedule on the page', () => {
  it('reads as a sentence', () => {
    expect(scheduleText(EVERY_15)).toBe('Every 15 minutes');
    expect(scheduleText(DAILY_8)).toBe('At 08:00 every day');
    expect(scheduleText({ kind: 'weekly', everyMinutes: null, times: [], weekdays: [] })).toBe(
      'An unreadable schedule',
    );
  });

  it('⚠ says a time of day is each workspace’s own, and how closely it is met', () => {
    expect(scheduleNote(DAILY_8, 15)).toBe(
      'In each workspace’s own time zone. Checked every 15 minutes, so a time is met within that long.',
    );
    expect(scheduleNote(EVERY_15, 15)).toBe('Everywhere at once.');
  });
});

describe('the schedule form', () => {
  const limits = { kinds: ['interval', 'daily'] as const, minEveryMinutes: 15 };

  it('opens on the schedule in force, with the other kind’s fields ready', () => {
    expect(scheduleDraftOf(DAILY_8, 15)).toEqual({
      kind: 'daily',
      everyMinutes: '60',
      times: ['08:00'],
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    });
    expect(scheduleDraftOf(EVERY_15, 15)).toMatchObject({ kind: 'interval', everyMinutes: '15', times: ['08:00'] });
  });

  it('accepts what the process allows', () => {
    expect(checkScheduleDraft({ kind: 'interval', everyMinutes: '30', times: [], weekdays: [] }, limits)).toBeNull();
    expect(checkScheduleDraft({ kind: 'daily', everyMinutes: '', times: ['08:00'], weekdays: [1] }, limits)).toBeNull();
  });

  it('⚠ refuses in the server’s own words, naming the limit', () => {
    expect(checkScheduleDraft({ kind: 'interval', everyMinutes: '5', times: [], weekdays: [] }, limits)).toBe(
      'This process can run at most every 15 minutes.',
    );
  });

  it('refuses a number that is not one, no times, and no days', () => {
    expect(checkScheduleDraft({ kind: 'interval', everyMinutes: 'soon', times: [], weekdays: [] }, limits)).toMatch(
      /whole number of minutes/u,
    );
    expect(checkScheduleDraft({ kind: 'daily', everyMinutes: '', times: [''], weekdays: [1] }, limits)).toBe(
      'Give at least one time of day.',
    );
    expect(checkScheduleDraft({ kind: 'daily', everyMinutes: '', times: ['08:00'], weekdays: [] }, limits)).toBe(
      'Choose at least one day of the week.',
    );
  });

  it('refuses a kind the process does not allow', () => {
    const dailyOnly = { kinds: ['daily'] as const, minEveryMinutes: 15 };
    expect(checkScheduleDraft({ kind: 'interval', everyMinutes: '30', times: [], weekdays: [] }, dailyOnly)).toMatch(
      /only run at set times of day/u,
    );
  });

  it('sends only the fields of its kind', () => {
    expect(scheduleOfDraft({ kind: 'interval', everyMinutes: ' 30 ', times: ['08:00'], weekdays: [1] })).toEqual({
      kind: 'interval',
      everyMinutes: 30,
    });
  });
});

describe('a run in words', () => {
  it('says who forced it, or that it was scheduled', () => {
    expect(runTitle(run())).toBe('Scheduled run');
    expect(runTitle(run({ trigger: 'forced', forcedByName: 'Ana Cruz' }))).toBe('Run forced by Ana Cruz');
    expect(runTitle(run({ trigger: 'forced' }))).toBe('Run forced by an administrator');
  });

  it('⚠ gives counts, never names', () => {
    expect(runSummary(run({ handled: 12, skippedLate: 1, leftForNext: 3 }))).toBe(
      '12 handled, 1 skipped as too late, 3 left for the next run.',
    );
    expect(runSummary(run({ handled: 4 }))).toBe('4 handled.');
    expect(runSummary(run())).toBe('Nothing was due.');
    expect(runSummary(run({ skippedLate: 2 }))).toBe('0 handled, 2 skipped as too late.');
  });

  it('says why a run failed or was skipped instead of its counts', () => {
    expect(runSummary(run({ state: 'failed', error: 'The mail server refused.' }))).toBe('The mail server refused.');
    expect(runSummary(run({ state: 'skipped', note: 'The process was paused after this run was queued.' }))).toBe(
      'The process was paused after this run was queued.',
    );
  });

  it('says how long it took, once it has both ends', () => {
    expect(runDurationText(run())).toBe('12 seconds');
    expect(runDurationText(run({ finishedAt: '2026-10-05T00:00:00.300Z' }))).toBe('under a second');
    expect(runDurationText(run({ finishedAt: '2026-10-05T00:02:00.000Z' }))).toBe('2 minutes');
    expect(runDurationText(run({ finishedAt: null }))).toBeNull();
  });
});

describe('a control action in words', () => {
  const control = (over: Partial<Parameters<typeof controlSummary>[0]>) => ({
    action: 'paused',
    actorName: 'Ana Cruz',
    reason: null,
    scheduleFrom: null,
    scheduleTo: null,
    ...over,
  });

  it('says who did what, and why for a pause', () => {
    expect(controlSummary(control({ reason: 'Mail is down.' }))).toBe('Ana Cruz paused it — Mail is down.');
    expect(controlSummary(control({ action: 'resumed' }))).toBe('Ana Cruz resumed it.');
    expect(controlSummary(control({ action: 'forced', actorName: null }))).toBe(
      'An administrator asked for a run now.',
    );
  });

  it('says what a schedule changed from and to', () => {
    expect(controlSummary(control({ action: 'rescheduled', scheduleFrom: DAILY_8, scheduleTo: EVERY_15 }))).toBe(
      'Ana Cruz changed the schedule, from “At 08:00 every day” to “Every 15 minutes”.',
    );
    expect(controlSummary(control({ action: 'reset_schedule', scheduleFrom: EVERY_15, scheduleTo: DAILY_8 }))).toBe(
      'Ana Cruz reset the schedule to its default, from “Every 15 minutes” to “At 08:00 every day”.',
    );
  });

  it('names nobody it cannot name', () => {
    expect(actorLabel(null)).toBe('An administrator');
  });
});

describe('times', () => {
  it('shows an instant in the zone asked for — the viewer’s, on the page', () => {
    // One instant, two days: 23:30 on the 4th in London, 06:30 on the 5th in Manila.
    const instant = '2026-10-04T22:30:00.000Z';
    expect(whenText(instant, 'Asia/Manila')).toMatch(/5/u);
    expect(whenText(instant, 'Europe/London')).toMatch(/4/u);
    expect(whenText(null)).toBe('—');
    expect(whenText('not a date')).toBe('—');
  });

  it('says how long ago something was, in its largest whole unit', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    expect(agoText('2026-10-05T11:59:40.000Z', now)).toBe('just now');
    expect(agoText('2026-10-05T11:55:00.000Z', now)).toBe('5 minutes ago');
    expect(agoText('2026-10-05T09:30:00.000Z', now)).toBe('2 hours ago');
    expect(agoText('2026-10-02T12:00:00.000Z', now)).toBe('3 days ago');
    // A browser clock behind the server's: never "in the future".
    expect(agoText('2026-10-05T12:00:30.000Z', now)).toBe('just now');
    expect(agoText(null, now)).toBeNull();
  });

  it('says how long until the next check', () => {
    const now = new Date('2026-10-05T00:00:00Z');
    expect(untilText('2026-10-05T00:04:00.000Z', now)).toBe('in 4 minutes');
    expect(untilText('2026-10-05T02:00:00.000Z', now)).toBe('in 2 hours');
    expect(untilText('2026-10-04T23:00:00.000Z', now)).toBe('now');
    expect(untilText(null, now)).toBeNull();
  });
});
