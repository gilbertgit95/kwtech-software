import { checkEnqueue, isRunDue, runCount, runErrorText, runLeaseExpiry } from '../src/domain/queue.js';

const NOW = new Date('2026-10-05T00:00:00Z');
const live = { deprecatedAt: null, pausedAt: null, activeRunId: null };

describe('whether a process may be queued', () => {
  it('may, when it is live, not paused and not already queued', () => {
    expect(checkEnqueue(live)).toBeNull();
  });

  it('refuses each reason by name', () => {
    expect(checkEnqueue(null)).toBe('unknown_process');
    expect(checkEnqueue({ ...live, deprecatedAt: NOW })).toBe('deprecated');
    expect(checkEnqueue({ ...live, pausedAt: NOW })).toBe('paused');
    expect(checkEnqueue({ ...live, activeRunId: 'run-1' })).toBe('already_queued');
  });

  it('⚠ reads a pause state it cannot make sense of as paused', () => {
    expect(checkEnqueue({ ...live, pausedAt: 'yes' })).toBe('paused');
    expect(checkEnqueue({ ...live, pausedAt: 0 })).toBe('paused');
  });
});

describe('whether a schedule has come round', () => {
  it('has, for a process never queued', () => {
    expect(isRunDue(null, 15, NOW)).toBe(true);
  });

  it('has once the cadence has passed since it was last queued, and not a minute before', () => {
    expect(isRunDue(new Date('2026-10-04T23:46:00Z'), 15, NOW)).toBe(false);
    expect(isRunDue(new Date('2026-10-04T23:45:00Z'), 15, NOW)).toBe(true);
  });
});

describe('what is kept of a run', () => {
  it('believes a running row for its time limit and a grace beyond', () => {
    expect(runLeaseExpiry(NOW, 60).toISOString()).toBe('2026-10-05T00:01:30.000Z');
  });

  it('keeps an error’s message, cut short, and says so when there is none', () => {
    expect(runErrorText(new Error('  The mail server refused.  '))).toBe('The mail server refused.');
    expect(runErrorText(new Error(''))).toBe('It failed without saying why.');
    expect(runErrorText('x'.repeat(900))).toHaveLength(500);
  });

  it('stores only whole, non-negative counts whatever a process reported', () => {
    expect(runCount(12)).toBe(12);
    expect(runCount(2.9)).toBe(2);
    expect(runCount(-4)).toBe(0);
    expect(runCount(Number.NaN)).toBe(0);
    expect(runCount(undefined)).toBe(0);
  });
});
