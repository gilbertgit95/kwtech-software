import {
  checkPause,
  checkReschedule,
  checkResume,
  JOB_PAUSE_REASON_MAX,
  nextCheckAt,
  preparePauseReason,
  processStanding,
} from '../src/domain/controls.js';

const NOW = new Date('2026-10-05T00:00:00Z');
const minutesAfter = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

const LIVE = { deprecatedAt: null, pausedAt: null };
const PAUSED = { deprecatedAt: null, pausedAt: NOW };
const RETIRED = { deprecatedAt: NOW, pausedAt: null };

describe('a pause’s reason', () => {
  it('is trimmed', () => {
    expect(preparePauseReason('  The mail server is down.  ')).toEqual({ reason: 'The mail server is down.' });
  });

  it('⚠ is required — a pause nobody explained is refused', () => {
    expect(preparePauseReason('   ')).toEqual({ refused: 'reason_required' });
    expect(preparePauseReason(null)).toEqual({ refused: 'reason_required' });
  });

  it('is kept short', () => {
    expect(preparePauseReason('x'.repeat(JOB_PAUSE_REASON_MAX))).toEqual({ reason: 'x'.repeat(JOB_PAUSE_REASON_MAX) });
    expect(preparePauseReason('x'.repeat(JOB_PAUSE_REASON_MAX + 1))).toEqual({ refused: 'reason_too_long' });
  });
});

describe('what may be done to a process', () => {
  it('pauses a live one, and refuses one already paused, retired or unknown', () => {
    expect(checkPause(LIVE)).toBeNull();
    expect(checkPause(PAUSED)).toBe('already_paused');
    expect(checkPause(RETIRED)).toBe('deprecated');
    expect(checkPause(null)).toBe('unknown_process');
  });

  it('⚠ reads any pausedAt as paused — fail closed, as the queue does', () => {
    expect(checkPause({ deprecatedAt: null, pausedAt: 'not a date' })).toBe('already_paused');
  });

  it('resumes only what is paused — a retired one included, so its pause can be tidied', () => {
    expect(checkResume(PAUSED)).toBeNull();
    expect(checkResume({ deprecatedAt: NOW, pausedAt: NOW })).toBeNull();
    expect(checkResume(LIVE)).toBe('not_paused');
    expect(checkResume(null)).toBe('unknown_process');
  });

  it('reschedules a live one, paused or not, and never a retired one', () => {
    expect(checkReschedule(LIVE)).toBeNull();
    expect(checkReschedule(PAUSED)).toBeNull();
    expect(checkReschedule(RETIRED)).toBe('deprecated');
    expect(checkReschedule(null)).toBe('unknown_process');
  });
});

describe('how a process stands', () => {
  const idle = { synced: true, pausedAt: null, activeRunState: null, lastOutcome: null } as const;

  it('is idle with nothing to say', () => {
    expect(processStanding(idle)).toBe('idle');
    expect(processStanding({ ...idle, lastOutcome: 'succeeded' })).toBe('idle');
  });

  it('is failing when its last finished run failed', () => {
    expect(processStanding({ ...idle, lastOutcome: 'failed' })).toBe('failing');
  });

  it('says what it is doing before how it last went', () => {
    expect(processStanding({ ...idle, activeRunState: 'queued', lastOutcome: 'failed' })).toBe('queued');
    expect(processStanding({ ...idle, activeRunState: 'running', lastOutcome: 'failed' })).toBe('running');
  });

  it('⚠ says paused before anything else it is doing — that is what stops it', () => {
    expect(processStanding({ ...idle, pausedAt: NOW, activeRunState: 'running', lastOutcome: 'failed' })).toBe(
      'paused',
    );
  });

  it('⚠ says never synced first: nothing else about it is true yet', () => {
    expect(processStanding({ ...idle, synced: false, pausedAt: NOW })).toBe('unsynced');
  });
});

describe('when the runner next queues a process', () => {
  it('is now for one never queued', () => {
    expect(nextCheckAt(null, 15, NOW)).toEqual(NOW);
  });

  it('is one cadence after it was last queued', () => {
    expect(nextCheckAt(NOW, 15, minutesAfter(5))).toEqual(minutesAfter(15));
  });

  it('is now, never the past, for one already overdue', () => {
    expect(nextCheckAt(NOW, 15, minutesAfter(40))).toEqual(minutesAfter(40));
  });
});
