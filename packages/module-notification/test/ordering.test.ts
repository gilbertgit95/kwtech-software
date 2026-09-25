import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  NOTIFICATION_PAGE_MAX,
  planPage,
  runOf,
  runsFor,
} from '../src/domain/ordering.js';

const at = new Date('2026-09-25T09:00:00.000Z');

describe('runsFor — the runs a listing walks', () => {
  it('walks unread then read by default, one run for newest, and only unread when asked', () => {
    expect(runsFor('unread_first', false)).toEqual(['unread', 'read']);
    expect(runsFor('newest', false)).toEqual(['all']);
    expect(runsFor('unread_first', true)).toEqual(['unread']);
    expect(runsFor('newest', true)).toEqual(['unread']);
  });

  it('files a row under the run its cursor must point into', () => {
    expect(runOf({ readAt: null }, 'unread_first', false)).toBe('unread');
    expect(runOf({ readAt: at }, 'unread_first', false)).toBe('read');
    expect(runOf({ readAt: at }, 'newest', false)).toBe('all');
  });
});

describe('planPage', () => {
  const runs = runsFor('unread_first', false);

  it('starts at the top of every run with no cursor', () => {
    expect(planPage(runs, { after: null, before: null })).toEqual({
      direction: 'forward',
      steps: [
        { run: 'unread', from: null },
        { run: 'read', from: null },
      ],
    });
  });

  it('⚠ continues from an unread cursor into the read run — a page can cross the boundary', () => {
    const cursor = { run: 'unread' as const, occurredAt: at, id: 'n5' };
    expect(planPage(runs, { after: cursor, before: null }).steps).toEqual([
      { run: 'unread', from: cursor },
      { run: 'read', from: null },
    ]);
  });

  it('continues from a read cursor without going back to the unread run', () => {
    const cursor = { run: 'read' as const, occurredAt: at, id: 'n9' };
    expect(planPage(runs, { after: cursor, before: null }).steps).toEqual([{ run: 'read', from: cursor }]);
  });

  it('goes BACK from a read cursor into the end of the unread run', () => {
    const cursor = { run: 'read' as const, occurredAt: at, id: 'n9' };
    expect(planPage(runs, { after: null, before: cursor })).toEqual({
      direction: 'backward',
      steps: [
        { run: 'read', from: cursor },
        { run: 'unread', from: null },
      ],
    });
  });

  it('starts over when the cursor names a run this listing does not walk (the order changed under it)', () => {
    const cursor = { run: 'all' as const, occurredAt: at, id: 'n1' };
    expect(planPage(runs, { after: cursor, before: null }).steps).toEqual([
      { run: 'unread', from: null },
      { run: 'read', from: null },
    ]);
  });
});

describe('the cursor', () => {
  it('round-trips', () => {
    const cursor = { run: 'read' as const, occurredAt: at, id: 'ckabc123' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('is URL-safe', () => {
    expect(encodeCursor({ run: 'unread', occurredAt: at, id: 'x'.repeat(40) })).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    '',
    'not base64 at all!',
    btoa('{"r":"sideways","o":"2026-01-01T00:00:00Z","i":"x"}'),
    btoa('{"r":"read","o":"never","i":"x"}'),
    btoa('[]'),
  ])('⚠ refuses a cursor it did not write (%s) rather than silently starting over', (value) => {
    expect(decodeCursor(value)).toBeNull();
  });
});

describe('clampPageSize', () => {
  it('defaults, clamps and truncates', () => {
    expect(clampPageSize(undefined)).toBe(20);
    expect(clampPageSize(null)).toBe(20);
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(10_000)).toBe(NOTIFICATION_PAGE_MAX);
    expect(clampPageSize(33.7)).toBe(33);
  });
});
