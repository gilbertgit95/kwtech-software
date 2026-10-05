import type { StudioLogEntryView } from '../src/react/studio-client.js';
import { actionLabel, clockTime, entrySummary, groupByDay } from '../src/react/view/history.js';

function entry(createdAt: string, overrides: Partial<StudioLogEntryView> = {}): StudioLogEntryView {
  return {
    id: createdAt,
    action: 'downloaded',
    kind: 'layout',
    userId: 'user-ana',
    userName: 'Ana',
    mine: true,
    layoutId: null,
    layoutName: 'ID package',
    paperLabel: '4R',
    paperWidth: 10160,
    paperHeight: 15240,
    pages: 1,
    copies: 1,
    fileNames: [],
    createdAt,
    ...overrides,
  };
}

describe('groupByDay', () => {
  /**
   * 15:00Z and 17:00Z on 5 October are 11 pm on the 5th and 1 am on the 6th in
   * Manila — two days there, one day in London.
   */
  const entries = [entry('2026-10-05T17:00:00Z', { pages: 2, copies: 3 }), entry('2026-10-05T15:00:00Z')];

  it('⚠ groups by the WORKSPACE’s day, not UTC’s', () => {
    const manila = groupByDay(entries, 'Asia/Manila');
    expect(manila.map((day) => day.day)).toEqual(['2026-10-06', '2026-10-05']);

    const london = groupByDay(entries, 'Europe/London');
    expect(london.map((day) => day.day)).toEqual(['2026-10-05']);
    expect(london[0]?.entries).toHaveLength(2);
  });

  it('counts a day’s sheets with their copies', () => {
    expect(groupByDay(entries, 'Europe/London')[0]?.sheets).toBe(7);
  });

  it('keeps the order it was given', () => {
    expect(groupByDay(entries, 'Europe/London')[0]?.entries.map((one) => one.id)).toEqual([
      '2026-10-05T17:00:00Z',
      '2026-10-05T15:00:00Z',
    ]);
  });
});

describe('reading an entry', () => {
  it('shows the time in the workspace’s zone', () => {
    expect(clockTime('2026-10-05T15:00:00Z', 'Asia/Manila')).toMatch(/11:00/u);
    expect(clockTime('2026-10-05T15:00:00Z', 'Europe/London')).toMatch(/4:00/u);
  });

  it('⚠ never says "printed": a browser cannot know paper came out', () => {
    expect(actionLabel('downloaded')).toBe('Downloaded');
    expect(actionLabel('sent_to_print')).toBe('Sent to print');
  });

  it('says how much went on what paper', () => {
    expect(entrySummary({ pages: 1, copies: 1, paperLabel: '4R' })).toBe('1 sheet on 4R');
    expect(entrySummary({ pages: 2, copies: 3, paperLabel: 'A4' })).toBe('2 sheets × 3 copies on A4');
  });
});
