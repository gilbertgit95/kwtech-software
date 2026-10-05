import {
  encodeHistoryCursor,
  historyPageSize,
  JOB_HISTORY_PAGE,
  JOB_HISTORY_PAGE_MAX,
  mergeHistory,
  parseHistoryCursor,
} from '../src/domain/history.js';

const NOW = new Date('2026-10-05T00:00:00Z');
const minutesAfter = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

const run = (id: string, minutes: number) => ({ id, queuedAt: minutesAfter(minutes) });
const control = (id: string, minutes: number) => ({ id, createdAt: minutesAfter(minutes) });

const ids = (page: { items: Array<{ id: string }> }) => page.items.map((item) => item.id);

describe('a history cursor', () => {
  it('survives the round trip', () => {
    const cursor = { at: minutesAfter(3), id: 'run-1' };
    expect(parseHistoryCursor(encodeHistoryCursor(cursor))).toEqual(cursor);
  });

  it('⚠ is refused when this code did not write it', () => {
    expect(parseHistoryCursor('')).toBeNull();
    expect(parseHistoryCursor('not-a-cursor')).toBeNull();
    expect(parseHistoryCursor('yesterday~run-1')).toBeNull();
    expect(parseHistoryCursor('2026-10-05T00:00:00.000Z~')).toBeNull();
  });
});

describe('the page size', () => {
  it('is the caller’s, inside the bounds, or the default', () => {
    expect(historyPageSize(null)).toBe(JOB_HISTORY_PAGE);
    expect(historyPageSize(0)).toBe(JOB_HISTORY_PAGE);
    expect(historyPageSize(2.5)).toBe(JOB_HISTORY_PAGE);
    expect(historyPageSize(10)).toBe(10);
    expect(historyPageSize(10_000)).toBe(JOB_HISTORY_PAGE_MAX);
  });
});

describe('merging runs and control actions', () => {
  it('is one list, newest first, saying which each is', () => {
    const page = mergeHistory([run('run-1', 0), run('run-2', 30)], [control('control-1', 10)], null, 10);

    expect(ids(page)).toEqual(['run-2', 'control-1', 'run-1']);
    expect(page.items.map((item) => item.entry.kind)).toEqual(['run', 'control', 'run']);
    expect(page.nextCursor).toBeNull();
  });

  it('stops at the page size and points at the last entry shown', () => {
    const page = mergeHistory([run('run-1', 0), run('run-2', 30)], [control('control-1', 10)], null, 2);

    expect(ids(page)).toEqual(['run-2', 'control-1']);
    expect(page.nextCursor).toEqual({ at: minutesAfter(10), id: 'control-1' });
  });

  it('carries on after the cursor, dropping what was already shown', () => {
    const runs = [run('run-1', 0), run('run-2', 30)];
    const controls = [control('control-1', 10)];
    const first = mergeHistory(runs, controls, null, 2);
    const second = mergeHistory(runs, controls, first.nextCursor, 2);

    expect(ids(second)).toEqual(['run-1']);
    expect(second.nextCursor).toBeNull();
  });

  it('⚠ loses nothing when a run and its control action share an instant across a page break', () => {
    // "Run now" writes both with one clock.
    const runs = [run('run-9', 5), run('run-1', 0)];
    const controls = [control('control-9', 5)];
    const first = mergeHistory(runs, controls, null, 1);
    const second = mergeHistory(runs, controls, first.nextCursor, 1);
    const third = mergeHistory(runs, controls, second.nextCursor, 1);

    expect([...ids(first), ...ids(second), ...ids(third)].sort()).toEqual(['control-9', 'run-1', 'run-9']);
    expect(third.nextCursor).toBeNull();
  });
});
