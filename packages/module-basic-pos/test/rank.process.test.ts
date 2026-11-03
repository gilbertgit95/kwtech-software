import type { ProcessRunContext, ProcessSchedule, ProcessWorkspace } from '@kwtech/module-kit';
import { POS_PROCESS_REGISTRY } from '../src/processes.js';
import type { PosOrderStatus } from '../src/types.js';
import { harness, OTHER_STORE, SCOPE } from './harness.js';

const MANILA: ProcessWorkspace = { ...SCOPE, timeZone: 'Asia/Manila' };
const NEW_YORK: ProcessWorkspace = { ...OTHER_STORE, timeZone: 'America/New_York' };

const AT_THREE: ProcessSchedule = { kind: 'daily', times: ['03:00'], weekdays: [0, 1, 2, 3, 4, 5, 6] };

/**
 * 19:10 UTC on Tuesday 3 Nov 2026: 03:10 on WEDNESDAY the 4th in Manila, and
 * 14:10 on Tuesday the 3rd in New York. Manila ranks the 4th (counting
 * 28 Oct – 3 Nov); New York ranks the 3rd (counting 27 Oct – 2 Nov).
 */
const THREE_TEN_MANILA = new Date('2026-11-03T19:10:00Z');

/** What the runner hands a run: the declaration's own limits unless a test says otherwise. */
function contextOf(
  now: Date,
  workspaces: readonly ProcessWorkspace[] = [MANILA],
  overrides: Partial<ProcessRunContext> = {},
): ProcessRunContext {
  return {
    now,
    schedule: AT_THREE,
    maxItems: 200,
    tooLateAfterMinutes: 1200,
    signal: new AbortController().signal,
    async workspaces(cursor) {
      return cursor === null ? { workspaces, nextCursor: null } : { workspaces: [], nextCursor: null };
    },
    ...overrides,
  };
}

type Harness = ReturnType<typeof harness>;

let orderSeq = 0;

/**
 * An order straight into the fake's tables, as the write service leaves one:
 * the ranking reads rows, so how they were sold does not matter here.
 */
function order(
  h: Harness,
  store: typeof SCOPE,
  finalisedAt: string | null,
  lines: readonly (string | [string, string])[],
  status: PosOrderStatus = 'paid',
): void {
  orderSeq += 1;
  const id = `order-${orderSeq}`;
  h.prisma.state.posOrder.push({ id, ...store, status, finalisedAt: finalisedAt ? new Date(finalisedAt) : null });
  for (const [position, line] of lines.entries()) {
    const [itemId, variantId] = typeof line === 'string' ? [line, null] : line;
    h.prisma.state.posOrderLine.push({ id: `${id}-${position}`, orderId: id, ...store, position, itemId, variantId });
  }
}

async function ranksOf(h: Harness, store = SCOPE) {
  const ranks = await h.catalogue.ranks(store);
  return {
    items: Object.fromEntries(ranks.items.map((entry) => [entry.id, entry.rank])),
    variants: Object.fromEntries(ranks.variants.map((entry) => [entry.id, entry.rank])),
  };
}

describe('the process as declared', () => {
  it('serves the POS read key, runs at 03:00 every day, and says its limits', () => {
    expect(POS_PROCESS_REGISTRY).toEqual([
      expect.objectContaining({
        key: 'pos.rank_items',
        module: 'pos',
        serves: 'pos:read',
        defaultSchedule: AT_THREE,
        scheduleLimits: { kinds: ['daily'], minEveryMinutes: 15 },
        maxRunSeconds: 300,
        maxItemsPerRun: 200,
        tooLateAfterMinutes: 1200,
      }),
    ]);
  });
});

describe('ranking a store’s week (issue #47)', () => {
  it('ranks by the orders that included each item and size, once per order', async () => {
    const h = harness();
    // Manila 3 Nov, 10:00 — in the window.
    order(h, SCOPE, '2026-11-03T02:00:00Z', ['coffee', 'coffee', 'cake']);
    order(h, SCOPE, '2026-11-02T02:00:00Z', ['coffee', ['tea', 'tea-l']]);
    order(h, SCOPE, '2026-11-01T02:00:00Z', [
      ['tea', 'tea-l'],
      ['tea', 'tea-s'],
    ]);
    order(h, SCOPE, '2026-10-30T02:00:00Z', [['tea', 'tea-l']], 'unpaid');

    expect(await h.ranker.run(contextOf(THREE_TEN_MANILA))).toEqual({ handled: 1, skippedLate: 0, leftForNext: 0 });
    // coffee: 2 orders; tea: 3; cake: 1. tea-l: 3 orders; tea-s: 1.
    expect(await ranksOf(h)).toEqual({ items: { tea: 1, coffee: 2, cake: 3 }, variants: { 'tea-l': 1, 'tea-s': 2 } });
  });

  it('⚠ counts finalised orders only — paid and unpaid, never voided, cancelled or still open', async () => {
    const h = harness();
    const day = '2026-11-02T02:00:00Z';
    order(h, SCOPE, day, ['paid'], 'paid');
    order(h, SCOPE, day, ['unpaid'], 'unpaid');
    order(h, SCOPE, day, ['voided'], 'voided');
    order(h, SCOPE, day, ['cancelled'], 'cancelled');
    order(h, SCOPE, null, ['open'], 'open');

    await h.ranker.run(contextOf(THREE_TEN_MANILA));
    expect(Object.keys((await ranksOf(h)).items).sort()).toEqual(['paid', 'unpaid']);
  });

  it('counts the 7 days before, in the store’s own zone — not today, and not the 8th day back', async () => {
    const h = harness();
    // 28 Oct 00:30 in Manila (27 Oct 16:30 UTC): the window's first minutes.
    order(h, SCOPE, '2026-10-27T16:30:00Z', ['first-day']);
    // 27 Oct 23:30 in Manila: one day too old.
    order(h, SCOPE, '2026-10-27T15:30:00Z', ['too-old']);
    // 3 Nov 23:30 in Manila: the window's last minutes.
    order(h, SCOPE, '2026-11-03T15:30:00Z', ['last-day']);
    // 4 Nov 01:00 in Manila: today, which is never counted.
    order(h, SCOPE, '2026-11-03T17:00:00Z', ['today']);

    await h.ranker.run(contextOf(THREE_TEN_MANILA));
    expect(Object.keys((await ranksOf(h)).items).sort()).toEqual(['first-day', 'last-day']);
  });

  it('does nothing before the store’s 03:00', async () => {
    const h = harness();
    order(h, SCOPE, '2026-11-02T02:00:00Z', ['coffee']);
    // 02:50 on the 4th in Manila.
    expect(await h.ranker.run(contextOf(new Date('2026-11-03T18:50:00Z')))).toEqual({
      handled: 0,
      skippedLate: 0,
      leftForNext: 0,
    });
    expect(await ranksOf(h)).toEqual({ items: {}, variants: {} });
  });

  it('runs once a day: a second sweep the same day finds the store done', async () => {
    const h = harness();
    order(h, SCOPE, '2026-11-02T02:00:00Z', ['coffee']);
    await h.ranker.run(contextOf(THREE_TEN_MANILA));
    // Sold since: a second sweep must not pick it up today.
    order(h, SCOPE, '2026-11-02T03:00:00Z', ['cake']);
    order(h, SCOPE, '2026-11-02T04:00:00Z', ['cake']);

    expect(await h.ranker.run(contextOf(new Date('2026-11-03T19:25:00Z')))).toEqual({
      handled: 0,
      skippedLate: 0,
      leftForNext: 0,
    });
    expect((await ranksOf(h)).items).toEqual({ coffee: 1 });
    expect(h.prisma.state.posRanking).toEqual([
      expect.objectContaining({ ...SCOPE, rankedFor: new Date('2026-11-04T00:00:00Z'), outcome: 'ranked' }),
    ]);
  });

  it('⚠ replaces the snapshot the next day rather than adding to it', async () => {
    const h = harness();
    order(h, SCOPE, '2026-10-28T02:00:00Z', ['old-favourite']);
    order(h, SCOPE, '2026-11-02T02:00:00Z', ['coffee']);
    await h.ranker.run(contextOf(THREE_TEN_MANILA));
    expect((await ranksOf(h)).items).toEqual({ 'old-favourite': 1, coffee: 1 });

    // The 5th: 28 Oct has left the window.
    expect((await h.ranker.run(contextOf(new Date('2026-11-04T19:10:00Z')))).handled).toBe(1);
    expect((await ranksOf(h)).items).toEqual({ coffee: 1 });
    expect(h.prisma.state.posItemRank).toHaveLength(1);
  });

  it('keeps each store’s ranking its own', async () => {
    const h = harness();
    order(h, SCOPE, '2026-11-02T02:00:00Z', ['coffee']);
    order(h, OTHER_STORE, '2026-11-02T02:00:00Z', ['bread']);
    await h.ranker.run(contextOf(THREE_TEN_MANILA, [MANILA, { ...NEW_YORK, timeZone: 'Asia/Manila' }]));
    expect((await ranksOf(h, SCOPE)).items).toEqual({ coffee: 1 });
    expect((await ranksOf(h, OTHER_STORE)).items).toEqual({ bread: 1 });
  });

  it('works out “today” in each store’s zone at one instant', async () => {
    const h = harness();
    // 3 Nov 20:00 in Manila, but 3 Nov 07:00 in New York — that store's today.
    order(h, SCOPE, '2026-11-03T12:00:00Z', ['manila-coffee']);
    order(h, OTHER_STORE, '2026-11-03T12:00:00Z', ['new-york-coffee']);
    // 2 Nov 21:00 in New York: inside its window.
    order(h, OTHER_STORE, '2026-11-03T02:00:00Z', ['new-york-bagel']);

    expect(await h.ranker.run(contextOf(THREE_TEN_MANILA, [MANILA, NEW_YORK]))).toEqual({
      handled: 2,
      skippedLate: 0,
      leftForNext: 0,
    });
    expect((await ranksOf(h, SCOPE)).items).toEqual({ 'manila-coffee': 1 });
    expect((await ranksOf(h, OTHER_STORE)).items).toEqual({ 'new-york-bagel': 1 });
    const days = Object.fromEntries(h.prisma.state.posRanking.map((row) => [row.workspaceId, row.rankedFor]));
    expect(days).toEqual({
      [SCOPE.workspaceId]: new Date('2026-11-04T00:00:00Z'),
      [OTHER_STORE.workspaceId]: new Date('2026-11-03T00:00:00Z'),
    });
  });

  it('stops at its store limit, counts what waits, and the next sweep finishes', async () => {
    const h = harness();
    order(h, SCOPE, '2026-11-02T02:00:00Z', ['coffee']);
    order(h, OTHER_STORE, '2026-11-02T02:00:00Z', ['bread']);
    const both = [MANILA, { ...NEW_YORK, timeZone: 'Asia/Manila' }];

    expect(await h.ranker.run(contextOf(THREE_TEN_MANILA, both, { maxItems: 1 }))).toEqual({
      handled: 1,
      skippedLate: 0,
      leftForNext: 1,
    });
    expect(await h.ranker.run(contextOf(new Date('2026-11-03T19:25:00Z'), both, { maxItems: 1 }))).toEqual({
      handled: 1,
      skippedLate: 0,
      leftForNext: 0,
    });
    expect((await ranksOf(h, OTHER_STORE)).items).toEqual({ bread: 1 });
  });

  it('skips a day it reaches too late, counts it once, and leaves the day before’s ranking', async () => {
    const h = harness();
    order(h, SCOPE, '2026-11-02T02:00:00Z', ['coffee']);
    await h.ranker.run(contextOf(THREE_TEN_MANILA));
    order(h, SCOPE, '2026-11-04T02:00:00Z', ['cake']);

    // 23:30 on the 5th in Manila: 20 h 30 min after 03:00.
    const late = new Date('2026-11-05T15:30:00Z');
    expect(await h.ranker.run(contextOf(late))).toEqual({ handled: 0, skippedLate: 1, leftForNext: 0 });
    expect(await h.ranker.run(contextOf(new Date('2026-11-05T15:45:00Z')))).toEqual({
      handled: 0,
      skippedLate: 0,
      leftForNext: 0,
    });
    expect((await ranksOf(h)).items).toEqual({ coffee: 1 });
    expect(h.prisma.state.posRanking).toEqual([
      expect.objectContaining({ rankedFor: new Date('2026-11-05T00:00:00Z'), outcome: 'skipped_late' }),
    ]);
  });

  it('writes nothing when it is told to stop, so the next sweep ranks the store', async () => {
    const h = harness();
    order(h, SCOPE, '2026-11-02T02:00:00Z', ['coffee']);
    const stopped = new AbortController();
    stopped.abort();
    expect(await h.ranker.run(contextOf(THREE_TEN_MANILA, [MANILA], { signal: stopped.signal }))).toEqual({
      handled: 0,
      skippedLate: 0,
      leftForNext: 0,
    });
    expect(h.prisma.state.posRanking).toEqual([]);
    expect((await h.ranker.run(contextOf(THREE_TEN_MANILA))).handled).toBe(1);
  });

  it('ranks a store with no sales as ranked, with nothing in it', async () => {
    const h = harness();
    expect((await h.ranker.run(contextOf(THREE_TEN_MANILA))).handled).toBe(1);
    expect(await ranksOf(h)).toEqual({ items: {}, variants: {} });
  });
});

describe('what a till reads', () => {
  it('is ranks, never the counts', async () => {
    const h = harness();
    order(h, SCOPE, '2026-11-02T02:00:00Z', ['coffee']);
    order(h, SCOPE, '2026-11-02T03:00:00Z', ['coffee']);
    await h.ranker.run(contextOf(THREE_TEN_MANILA));
    const answer = await h.resolver.posRanks(SCOPE.organizationId, SCOPE.workspaceId);
    expect(answer).toEqual({ items: [{ id: 'coffee', rank: 1 }], variants: [] });
  });
});
