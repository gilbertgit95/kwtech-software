import { fileCleanupCutoff, fileCleanupMoment, fileDeletionAt, isValidRetentionHours } from '../src/index.js';

const MANILA = 'Asia/Manila';
const LONDON = 'Europe/London';
const DAILY = { kind: 'daily' as const, times: ['22:00'] };

describe('when a file is deleted', () => {
  it('keeps a file uploaded at 9 PM on Monday until 10 PM on Tuesday', () => {
    // Monday 16 Nov 2026, 21:00 in Manila (UTC+8) is 13:00Z.
    const uploaded = new Date('2026-11-16T13:00:00.000Z');
    expect(fileDeletionAt(uploaded, 24, MANILA)?.toISOString()).toBe('2026-11-17T14:00:00.000Z');
  });

  it('keeps a file uploaded at 10:05 PM two nights: it is not old enough at the next 10 PM', () => {
    const uploaded = new Date('2026-11-16T14:05:00.000Z');
    expect(fileDeletionAt(uploaded, 24, MANILA)?.toISOString()).toBe('2026-11-18T14:00:00.000Z');
  });

  it('follows the workspace’s zone: one instant, two different nights', () => {
    // 15:00Z is 23:00 Monday in Manila and 15:00 Monday in London.
    const uploaded = new Date('2026-11-16T15:00:00.000Z');
    expect(fileDeletionAt(uploaded, 24, MANILA)?.toISOString()).toBe('2026-11-18T14:00:00.000Z');
    expect(fileDeletionAt(uploaded, 24, LONDON)?.toISOString()).toBe('2026-11-17T22:00:00.000Z');
  });

  it('honours a shorter setting', () => {
    const uploaded = new Date('2026-11-16T04:00:00.000Z'); // noon in Manila
    expect(fileDeletionAt(uploaded, 1, MANILA)?.toISOString()).toBe('2026-11-16T14:00:00.000Z');
  });
});

describe('the moment a clean-up stands for', () => {
  it('is tonight’s 10 PM however late in the evening the sweep runs', () => {
    const late = new Date('2026-11-16T15:30:00.000Z'); // 23:30 Manila
    expect(fileCleanupMoment(DAILY, late, MANILA).toISOString()).toBe('2026-11-16T14:00:00.000Z');
  });

  it('is the run’s own clock for an interval schedule', () => {
    const now = new Date('2026-11-16T15:30:00.000Z');
    expect(fileCleanupMoment({ kind: 'interval' }, now, MANILA)).toBe(now);
  });

  it('cuts off files more than the retention before it, strictly', () => {
    const moment = new Date('2026-11-16T14:00:00.000Z');
    expect(fileCleanupCutoff(moment, 24).toISOString()).toBe('2026-11-15T14:00:00.000Z');
  });
});

describe('the retention setting', () => {
  it('takes whole hours from 1 to a week', () => {
    expect(isValidRetentionHours(1)).toBe(true);
    expect(isValidRetentionHours(168)).toBe(true);
    expect(isValidRetentionHours(0)).toBe(false);
    expect(isValidRetentionHours(169)).toBe(false);
    expect(isValidRetentionHours(1.5)).toBe(false);
  });
});
