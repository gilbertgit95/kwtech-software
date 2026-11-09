import { accessWindow } from '../src/domain/access.js';
import { paidUpTo, paidUpToMoved, planAutoRenew } from '../src/domain/auto-renew.js';
import { planReminders } from '../src/domain/notices.js';
import { isRefused, priceRequest } from '../src/domain/pricing.js';
import { isMonths, paidAheadOf } from '../src/domain/quotes.js';
import { buildCollectionsReport } from '../src/domain/reports.js';
import { billingStanding } from '../src/domain/standing.js';

/** Basic at 1,000.00 a month (centavos), from long ago. */
const PRICES = [{ planKey: 'basic', monthly: 100_000, effectiveFrom: '2026-01-01' }];

/** On Basic for 15 Nov to 15 Dec, access until 22 Dec (7 days of grace). */
const ROW = {
  planKey: 'basic',
  planArchived: false,
  periodStart: '2026-11-15',
  periodEnd: '2026-12-15',
  billingDay: 15,
  accessUntil: '2026-12-22',
};

function standingOn(today: string) {
  return billingStanding(ROW, today, 7, true);
}

describe('paying several months at once (#129)', () => {
  it('bills the month, then the months ahead as a line of their own', () => {
    const priced = priceRequest({
      kind: 'renew',
      planKey: 'basic',
      currentPlanKey: 'basic',
      standing: standingOn('2026-12-10'),
      prices: PRICES,
      creditBalance: 0,
      day: '2026-12-10',
      months: 6,
    });
    if (isRefused(priced)) throw new Error(priced.refused);
    expect(priced.quote.lines).toEqual([
      { kind: 'month', amount: 100_000 },
      { kind: 'paid_ahead', amount: 500_000, months: 5 },
    ]);
    expect(priced.quote.total).toBe(600_000);
    expect(paidAheadOf(priced.quote.lines)).toBe(500_000);
  });

  it('⚠ spends credit already held on this month only, never on the months being bought', () => {
    const priced = priceRequest({
      kind: 'subscribe',
      planKey: 'basic',
      currentPlanKey: null,
      standing: billingStanding(null, '2026-11-15', 7, false),
      prices: PRICES,
      creditBalance: 30_000,
      day: '2026-11-15',
      months: 3,
    });
    if (isRefused(priced)) throw new Error(priced.refused);
    // 1,000 − 300 credit for this month, then 2,000 for the two ahead: the balance is not spent to be handed back.
    expect(priced.quote.creditUsed).toBe(30_000);
    expect(priced.quote.total).toBe(70_000 + 200_000);
  });

  it('refuses months a request cannot buy: none, more than a year, or a plan change', () => {
    expect(isMonths(1)).toBe(true);
    expect(isMonths(12)).toBe(true);
    expect(isMonths(0)).toBe(false);
    expect(isMonths(13)).toBe(false);
    expect(isMonths(1.5)).toBe(false);
    const change = priceRequest({
      kind: 'change_plan',
      planKey: 'basic',
      currentPlanKey: 'basic',
      standing: standingOn('2026-11-20'),
      prices: PRICES,
      creditBalance: 0,
      day: '2026-11-20',
      months: 3,
    });
    expect(change).toEqual({ refused: 'invalid' });
  });
});

describe('planAutoRenew: whether the daily check renews from credit (#129)', () => {
  const base = {
    enabled: true,
    hasPendingRequest: false,
    cancelled: false,
    planArchived: false,
    renewal: { total: 0 },
  };

  it('renews on the due date, and on a grace day after it, when the credit pays the whole bill', () => {
    expect(planAutoRenew({ ...base, standing: standingOn('2026-12-15'), today: '2026-12-15' })).toEqual({
      kind: 'renew',
    });
    expect(planAutoRenew({ ...base, standing: standingOn('2026-12-18'), today: '2026-12-18' })).toEqual({
      kind: 'renew',
    });
  });

  it('does nothing before the due date, with the switch off, or after a cancel', () => {
    expect(planAutoRenew({ ...base, standing: standingOn('2026-12-14'), today: '2026-12-14' }).kind).toBe('not_due');
    expect(
      planAutoRenew({ ...base, enabled: false, standing: standingOn('2026-12-15'), today: '2026-12-15' }).kind,
    ).toBe('not_due');
    expect(
      planAutoRenew({ ...base, cancelled: true, standing: standingOn('2026-12-15'), today: '2026-12-15' }).kind,
    ).toBe('not_due');
  });

  it('skips, with the reason, when the credit is short, a request waits, the plan is gone or access ended', () => {
    const due = { standing: standingOn('2026-12-15'), today: '2026-12-15' };
    expect(planAutoRenew({ ...base, ...due, renewal: { total: 40_000 } })).toEqual({
      kind: 'skip',
      reason: 'credit_short',
      short: 40_000,
    });
    expect(planAutoRenew({ ...base, ...due, hasPendingRequest: true })).toMatchObject({ reason: 'pending_request' });
    expect(planAutoRenew({ ...base, ...due, planArchived: true })).toMatchObject({ reason: 'plan_archived' });
    expect(planAutoRenew({ ...base, ...due, renewal: { refused: 'price_not_set' } })).toMatchObject({
      reason: 'price_not_set',
    });
    expect(planAutoRenew({ ...base, standing: standingOn('2026-12-22'), today: '2026-12-22' })).toMatchObject({
      reason: 'access_ended',
    });
  });
});

describe('paidUpTo: the credit as a date (#129)', () => {
  const period = { end: '2026-12-15', billingDay: 15 };

  it('counts whole renewals at today’s price from the period end, on the billing day', () => {
    expect(paidUpTo(period, 100_000, 500_000)).toEqual({ months: 5, until: '2027-05-15' });
    expect(paidUpTo(period, 100_000, 150_000)).toEqual({ months: 1, until: '2027-01-15' });
    // The 31st clamps in short months and comes back.
    expect(paidUpTo({ end: '2027-01-31', billingDay: 31 }, 100_000, 100_000)).toEqual({
      months: 1,
      until: '2027-02-28',
    });
  });

  it('says nothing when the credit pays no renewal: too little, a debt, or no price', () => {
    expect(paidUpTo(period, 100_000, 99_999)).toBeNull();
    expect(paidUpTo(period, 100_000, -5_000)).toBeNull();
    expect(paidUpTo(period, null, 500_000)).toBeNull();
    expect(paidUpTo(period, 0, 500_000)).toBeNull();
  });
});

describe('the reminders with auto-renew on (#129)', () => {
  const window = accessWindow('2026-12-15', 7);

  it('says once, a week before, that the plan renews by itself, in place of the countdown', () => {
    const covered = { covered: true };
    expect(planReminders(window, '2026-12-07', null, covered)).toEqual([]);
    expect(planReminders(window, '2026-12-08', null, covered)).toEqual([
      { kind: 'auto_renew_upcoming', day: '2026-12-08', daysLeft: 7 },
    ]);
    // Keyed by the same day all week, so it is said once; never "renews in 3 days, pay now".
    expect(planReminders(window, '2026-12-12', null, covered)).toEqual([
      { kind: 'auto_renew_upcoming', day: '2026-12-08', daysLeft: 3 },
    ]);
  });

  it('counts down as usual when the credit does not cover the renewal', () => {
    expect(planReminders(window, '2026-12-08', null, { covered: false })[0]?.kind).toBe('due_in_7');
  });

  it('still says the due date and the overdue days when it could not renew', () => {
    expect(planReminders(window, '2026-12-15', null, { covered: true })[0]?.kind).toBe('due_today');
  });
});

describe('the collections report and credit-paid renewals (#129)', () => {
  it('counts no cash for a renewal paid from credit: it was counted when it came in', () => {
    const at = new Date('2026-12-15T04:00:00.000Z');
    const report = buildCollectionsReport({
      from: '2026-12-01',
      to: '2026-12-31',
      currency: 'PHP',
      timeZone: 'Asia/Manila',
      receipts: [
        { amount: 600_000, method: 'cash', kind: 'payment', issuedAt: at, voidedAt: null, planKey: 'basic' },
        { amount: 0, method: 'credit', kind: 'paid_from_credit', issuedAt: at, voidedAt: null, planKey: 'basic' },
      ],
      planLabels: new Map([['basic', 'Basic']]),
    });
    expect(report.total).toBe(600_000);
    expect(report.receipts).toBe(1);
  });
});

describe('paidUpToMoved: a price rise that shortens the credit (#129)', () => {
  const period = { end: '2026-12-15', billingDay: 15 };
  const rise = [
    { planKey: 'basic', monthly: 100_000, effectiveFrom: '2026-01-01' },
    { planKey: 'basic', monthly: 125_000, effectiveFrom: '2026-12-01' },
  ];

  it('says how far the date moved, from the day the rise takes effect', () => {
    expect(paidUpToMoved({ prices: rise, planKey: 'basic', today: '2026-12-01', period, balance: 500_000 })).toEqual({
      effectiveFrom: '2026-12-01',
      before: '2027-05-15',
      after: '2027-04-15',
    });
    // A balance that no longer pays one whole renewal.
    expect(paidUpToMoved({ prices: rise, planKey: 'basic', today: '2026-12-03', period, balance: 110_000 })).toEqual({
      effectiveFrom: '2026-12-01',
      before: '2027-01-15',
      after: null,
    });
  });

  it('is quiet for a fall, an old change, a change still to come, or no credit', () => {
    const fall = [rise[0], { planKey: 'basic', monthly: 90_000, effectiveFrom: '2026-12-01' }].filter(
      (row): row is (typeof rise)[number] => row !== undefined,
    );
    expect(paidUpToMoved({ prices: fall, planKey: 'basic', today: '2026-12-01', period, balance: 500_000 })).toBeNull();
    expect(paidUpToMoved({ prices: rise, planKey: 'basic', today: '2026-12-09', period, balance: 500_000 })).toBeNull();
    expect(paidUpToMoved({ prices: rise, planKey: 'basic', today: '2026-11-30', period, balance: 500_000 })).toBeNull();
    expect(paidUpToMoved({ prices: rise, planKey: 'basic', today: '2026-12-01', period, balance: 0 })).toBeNull();
  });
});
