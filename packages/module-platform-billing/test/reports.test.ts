import {
  buildCollectionsReport,
  isStandingFilter,
  KEPT_AS_CREDIT_LABEL,
  matchesStanding,
  type ReportReceipt,
  summariseStandings,
} from '../src/domain/reports.js';
import type { BillingReportView } from '../src/react/billing-admin-client.js';
import { formatDay } from '../src/react/view/billing-view.js';
import {
  collectedTable,
  collectionsCsv,
  collectionsFileName,
  periodLabel,
  standingKindWords,
  standingLine,
} from '../src/react/view/report-view.js';
import { fakeBilling, giveSubscription, noonOn, setPrices } from './fake-client.js';

const at = (iso: string) => new Date(iso);

/** A receipt that stands unless told otherwise. */
function receipt(over: Partial<ReportReceipt>): ReportReceipt {
  return {
    amount: 100_000,
    method: 'cash',
    kind: 'payment',
    issuedAt: at('2026-11-15T04:00:00.000Z'),
    voidedAt: null,
    planKey: 'basic',
    ...over,
  };
}

describe('buildCollectionsReport: what was collected', () => {
  const report = buildCollectionsReport({
    from: '2026-11-01',
    to: '2026-12-31',
    currency: 'PHP',
    timeZone: 'Asia/Manila',
    planLabels: new Map([
      ['basic', 'Basic'],
      ['pro', 'Pro'],
    ]),
    receipts: [
      receipt({}),
      receipt({ method: 'e_wallet', amount: 50_000 }),
      receipt({ issuedAt: at('2026-12-02T04:00:00.000Z'), planKey: 'pro', amount: 300_000 }),
      // Voided: never money kept, whenever it was voided.
      receipt({ amount: 999_999, voidedAt: at('2027-01-05T04:00:00.000Z') }),
      // A payment kept as credit bought no plan.
      receipt({ kind: 'closed_as_credit', planKey: 'pro', amount: 20_000, method: 'bank_transfer' }),
    ],
  });

  it('totals what stands, never a voided receipt', () => {
    expect(report).toMatchObject({ total: 470_000, receipts: 4 });
  });

  it('sums by day and method, oldest first', () => {
    expect(report.byDay.map((row) => [row.period, row.method, row.amount, row.receipts])).toEqual([
      ['2026-11-15', 'bank_transfer', 20_000, 1],
      ['2026-11-15', 'cash', 100_000, 1],
      ['2026-11-15', 'e_wallet', 50_000, 1],
      ['2026-12-02', 'cash', 300_000, 1],
    ]);
  });

  it('sums by month and by method over the range', () => {
    expect(report.byMonth.map((row) => [row.period, row.method, row.amount])).toEqual([
      ['2026-11', 'bank_transfer', 20_000],
      ['2026-11', 'cash', 100_000],
      ['2026-11', 'e_wallet', 50_000],
      ['2026-12', 'cash', 300_000],
    ]);
    expect(report.byMethod.map((row) => [row.method, row.amount, row.receipts])).toEqual([
      ['bank_transfer', 20_000, 1],
      ['cash', 400_000, 2],
      ['e_wallet', 50_000, 1],
    ]);
  });

  it('credits each plan with what it earned, most first, and payments kept as credit apart', () => {
    expect(report.perPlan.map((row) => [row.planKey, row.planLabel, row.amount])).toEqual([
      ['pro', 'Pro', 300_000],
      ['basic', 'Basic', 150_000],
      [null, KEPT_AS_CREDIT_LABEL, 20_000],
    ]);
  });

  it('dates a receipt by its day in the billing zone, and counts nothing outside the range', () => {
    // 20:00Z on 31 October is 1 November in Manila, and still October in London.
    const evening = [receipt({ issuedAt: at('2026-10-31T20:00:00.000Z') })];
    const manila = buildCollectionsReport({
      from: '2026-11-01',
      to: '2026-11-30',
      currency: 'PHP',
      timeZone: 'Asia/Manila',
      planLabels: new Map(),
      receipts: evening,
    });
    expect(manila.byDay[0]?.period).toBe('2026-11-01');
    // An unknown plan keeps its key as its label.
    expect(manila.perPlan[0]?.planLabel).toBe('basic');
    const london = buildCollectionsReport({
      from: '2026-11-01',
      to: '2026-11-30',
      currency: 'PHP',
      timeZone: 'Europe/London',
      planLabels: new Map(),
      receipts: evening,
    });
    expect(london.total).toBe(0);
  });
});

describe('summariseStandings: every organization, counted', () => {
  it('counts each kind, and keeps credit held apart from credit owed', () => {
    const summary = summariseStandings([
      { kind: 'active', creditBalance: 20_000, pending: false },
      { kind: 'overdue', creditBalance: 0, pending: true },
      { kind: 'held', creditBalance: -5_000, pending: true },
      { kind: 'expired', creditBalance: 1_000, pending: false },
      { kind: 'none', creditBalance: 0, pending: false },
    ]);
    expect(summary).toEqual({
      organizations: 5,
      byKind: { active: 1, overdue: 1, held: 1, expired: 1, none: 1 },
      overdue: 2,
      expired: 1,
      pending: 2,
      creditHeld: 21_000,
      creditOwed: 5_000,
      organizationsWithCredit: 2,
    });
  });
});

describe('the organizations filter', () => {
  it('takes only the filters it names', () => {
    expect(isStandingFilter('attention')).toBe(true);
    expect(isStandingFilter('drop table')).toBe(false);
  });

  it('reads attention as overdue, held or expired', () => {
    const kinds = ['active', 'renewal_open', 'overdue', 'held', 'expired', 'none'];
    expect(kinds.filter((kind) => matchesStanding({ kind, creditBalance: 0, pending: false }, 'attention'))).toEqual([
      'overdue',
      'held',
      'expired',
    ]);
    expect(matchesStanding({ kind: 'active', creditBalance: -1, pending: false }, 'credit')).toBe(true);
    expect(matchesStanding({ kind: 'active', creditBalance: 0, pending: false }, null)).toBe(true);
  });
});

describe('the reports service, read from the store', () => {
  const now = noonOn('2026-11-20');

  /** Five organizations: active, overdue (in grace), expired, none, and one holding credit with a waiting request. */
  async function platform() {
    const billing = fakeBilling();
    await setPrices(billing);
    billing.people.organizationList = ['o1', 'o2', 'o3', 'o4', 'o5'].map((id) => ({ id, name: `Org ${id}` }));
    giveSubscription(billing, 'o1', 'basic', '2026-11-01', '2026-12-01', '2026-12-08');
    giveSubscription(billing, 'o2', 'basic', '2026-10-15', '2026-11-15', '2026-11-22');
    giveSubscription(billing, 'o3', 'basic', '2026-09-01', '2026-10-01', '2026-10-08');
    // o4 has no paid plan; o5 paid 1,200 for a 1,000 bill and asks to change plan.
    const request = await billing.writes.submit('o5', 'owner', 'subscribe', 'basic', noonOn('2026-11-10'));
    await billing.writes.enterPayment(
      'o5',
      request.id,
      'owner',
      { method: 'e_wallet', amount: 120_000, paidOn: '2026-11-10', reference: 'GC-1' },
      noonOn('2026-11-10'),
    );
    await billing.writes.approve(
      request.id,
      'approver',
      { detailsVersion: 1, method: 'e_wallet', amount: 120_000, paidOn: '2026-11-10', reference: 'GC-1' },
      noonOn('2026-11-10'),
    );
    await billing.writes.submit('o5', 'owner', 'change_plan', 'pro', noonOn('2026-11-12'));
    return billing;
  }

  it('lists every organization with its standing, by id', async () => {
    const billing = await platform();
    const page = await billing.reports.standings(now, null, null, null);
    expect(page.items.map((one) => [one.organizationId, one.entry.kind])).toEqual([
      ['o1', 'active'],
      ['o2', 'overdue'],
      ['o3', 'expired'],
      ['o4', 'none'],
      ['o5', 'active'],
    ]);
    expect(page.items[4]?.entry).toMatchObject({ creditBalance: 20_000, pending: true });
    expect(page.nextCursor).toBeNull();
  });

  it('filters, and pages on from the last organization examined', async () => {
    const billing = await platform();
    const first = await billing.reports.standings(now, null, 1, 'attention');
    expect(first.items.map((one) => one.organizationId)).toEqual(['o2']);
    expect(first.nextCursor).toBe('o2');
    const second = await billing.reports.standings(now, first.nextCursor, 1, 'attention');
    expect(second.items.map((one) => one.organizationId)).toEqual(['o3']);
    const rest = await billing.reports.standings(now, second.nextCursor, 1, 'attention');
    expect(rest).toEqual({ items: [], nextCursor: null });
  });

  it('counts the standings and reports what was collected', async () => {
    const billing = await platform();
    const { summary, complete } = await billing.reports.summary(now);
    expect(complete).toBe(true);
    expect(summary).toMatchObject({ organizations: 5, overdue: 1, expired: 1, pending: 1, creditHeld: 20_000 });
    const report = await billing.reports.collections('2026-11-01', '2026-11-30');
    expect(report).toMatchObject({ total: 120_000, receipts: 1 });
    expect(report.perPlan).toEqual([{ planKey: 'basic', planLabel: 'Basic', amount: 120_000, receipts: 1 }]);
    expect(report.byDay).toEqual([{ period: '2026-11-10', method: 'e_wallet', amount: 120_000, receipts: 1 }]);
    await expect(billing.reports.collections('2026-11-30', '2026-11-01')).rejects.toMatchObject({ reason: 'invalid' });
  });
});

describe('what the report pages show', () => {
  const report: BillingReportView = {
    from: '2026-11-01',
    to: '2026-11-30',
    currency: 'PHP',
    total: 170_000,
    receipts: 3,
    byDay: [
      { period: '2026-11-15', method: 'cash', amount: 100_000, receipts: 1 },
      { period: '2026-11-15', method: 'e_wallet', amount: 50_000, receipts: 1 },
      { period: '2026-11-20', method: 'e_wallet', amount: 20_000, receipts: 1 },
    ],
    byMonth: [],
    byMethod: [],
    perPlan: [{ planKey: 'basic', planLabel: 'Basic, "monthly"', amount: 170_000, receipts: 3 }],
    standings: {
      organizations: 0,
      byKind: [],
      overdue: 0,
      expired: 0,
      pending: 0,
      creditHeld: 0,
      creditOwed: 0,
      organizationsWithCredit: 0,
      complete: true,
      available: true,
    },
  };

  it('pivots collections into one row per period and a column per method, with totals', () => {
    const table = collectedTable(report.byDay);
    expect(table.methods).toEqual(['cash', 'e_wallet']);
    expect(table.rows).toEqual([
      { period: '2026-11-15', byMethod: { cash: 100_000, e_wallet: 50_000 }, total: 150_000 },
      { period: '2026-11-20', byMethod: { e_wallet: 20_000 }, total: 20_000 },
    ]);
    expect(table.totals).toEqual({ byMethod: { cash: 100_000, e_wallet: 70_000 }, total: 170_000 });
  });

  it('writes the CSV by day, then the totals, then each plan, quoted', () => {
    const lines = collectionsCsv(report).split('\r\n');
    expect(lines[0]).toBe('"Day","Cash","E-wallet","Total (PHP)"');
    expect(lines[2]).toBe('"2026-11-20","","200.00","200.00"');
    expect(lines[3]).toBe('"Totals","1000.00","700.00","1700.00"');
    expect(lines[6]).toBe('"Basic, ""monthly""","3","1700.00"');
    expect(collectionsFileName(report)).toBe('collections-2026-11-01-to-2026-11-30.csv');
  });

  it('labels a month and a day', () => {
    expect(periodLabel('2026-11')).toBe('Nov 2026');
    expect(periodLabel('2026-11-08')).toBe(formatDay('2026-11-08'));
  });

  it('words a standing with the day it turns on', () => {
    const base = {
      kind: 'overdue',
      days: 3,
      planKey: 'basic',
      planLabel: 'Basic',
      planArchived: false,
      cancelled: false,
      trial: false,
      periodStart: '2026-10-15',
      periodEnd: '2026-11-15',
      accessUntil: '2026-11-22',
      graceDays: 7,
      holdDays: 0,
      prepaid: false,
    };
    expect(standingLine({ standing: base, creditBalance: 0, pendingRequestId: null })).toEqual({
      word: 'Overdue',
      detail: `Access until ${formatDay('2026-11-22')}`,
      tone: 'warning',
    });
    expect(
      standingLine({
        standing: { ...base, kind: 'active', cancelled: true },
        creditBalance: 0,
        pendingRequestId: null,
      }),
    ).toMatchObject({ word: 'Active, cancelled', detail: `Due ${formatDay('2026-11-15')}` });
    expect(standingLine({ standing: { ...base, kind: 'none' }, creditBalance: 0, pendingRequestId: null }).tone).toBe(
      'muted',
    );
    expect(standingKindWords('held')).toBe('overdue, access held');
  });
});
