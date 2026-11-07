import {
  approvalLagCredit,
  archiveCredit,
  type Period,
  periodFrom,
  prorate,
  quoteMonth,
  quotePlanChange,
  quoteRenewal,
} from '../src/index.js';

/**
 * The bill's arithmetic (plan §4, "Prorated plan changes"). The worked example
 * in the plan — Basic 1,000 and Pro 1,500, a 30-day period, changed on day 15 —
 * is pinned exactly, in centavos.
 */
const BASIC = 100_000;
const PRO = 150_000;
/** November 2026: 30 days. Day 16 leaves 15 days, the plan's "day 15". */
const NOVEMBER: Period = periodFrom('2026-11-01');
const HALFWAY = '2026-11-16';

describe('prorate', () => {
  it('rounds once, half up, in whole centavos', () => {
    expect(prorate(100, 1, 3)).toBe(33);
    expect(prorate(200, 1, 3)).toBe(67);
    expect(prorate(1, 1, 2)).toBe(1);
    expect(prorate(-1, 1, 2)).toBe(-1);
    expect(prorate(100_000, 15, 30)).toBe(50_000);
  });

  it('refuses a float, or a period of no days', () => {
    expect(() => prorate(10.5, 1, 2)).toThrow(RangeError);
    expect(() => prorate(100, 1, 0)).toThrow(RangeError);
  });
});

describe('a plan change in the middle of a period', () => {
  it('⚠ Basic → Pro on day 15 of 30 pays 250', () => {
    const quote = quotePlanChange({
      oldMonthly: BASIC,
      newMonthly: PRO,
      period: NOVEMBER,
      day: HALFWAY,
      creditBalance: 0,
    });
    expect(quote.lines).toEqual([
      { kind: 'old_plan_unused', amount: -50_000, days: 15 },
      { kind: 'new_plan_days', amount: 75_000, days: 15 },
    ]);
    expect(quote).toMatchObject({ total: 25_000, creditUsed: 0, creditAdded: 0, owedCleared: 0 });
  });

  it('⚠ Pro → Basic on day 15 of 30 pays 0 and leaves 250 of credit', () => {
    const quote = quotePlanChange({
      oldMonthly: PRO,
      newMonthly: BASIC,
      period: NOVEMBER,
      day: HALFWAY,
      creditBalance: 0,
    });
    expect(quote).toMatchObject({ total: 0, creditAdded: 25_000 });
  });

  it('the credit lowers the next renewal: Basic 1,000 − 250 = 750', () => {
    expect(quoteRenewal(BASIC, 25_000)).toMatchObject({ total: 75_000, creditUsed: 25_000 });
  });

  it('on the first day the whole month is swapped; on the last, one day', () => {
    const first = quotePlanChange({
      oldMonthly: BASIC,
      newMonthly: PRO,
      period: NOVEMBER,
      day: '2026-11-01',
      creditBalance: 0,
    });
    const last = quotePlanChange({
      oldMonthly: BASIC,
      newMonthly: PRO,
      period: NOVEMBER,
      day: '2026-11-30',
      creditBalance: 0,
    });
    expect(first.total).toBe(50_000);
    expect(last.total).toBe(prorate(PRO, 1, 30) - prorate(BASIC, 1, 30));
  });

  it.each([
    ['February, 28 days', '2026-02-01', '2026-02-15', 14, 28],
    ['February in a leap year, 29 days', '2028-02-01', '2028-02-15', 15, 29],
    ['31 days', '2026-12-01', '2026-12-16', 16, 31],
  ])('prorates over %s', (_name, start, day, left, whole) => {
    const quote = quotePlanChange({
      oldMonthly: BASIC,
      newMonthly: PRO,
      period: periodFrom(start),
      day,
      creditBalance: 0,
    });
    expect(quote.lines[0]).toEqual({ kind: 'old_plan_unused', amount: -prorate(BASIC, left, whole), days: left });
    expect(quote.total).toBe(prorate(PRO, left, whole) - prorate(BASIC, left, whole));
  });

  it('spends a credit balance larger than the charge, and keeps the rest', () => {
    const quote = quotePlanChange({
      oldMonthly: BASIC,
      newMonthly: PRO,
      period: NOVEMBER,
      day: HALFWAY,
      creditBalance: 40_000,
    });
    expect(quote).toMatchObject({ total: 0, creditUsed: 25_000, creditAdded: 0 });
    expect(quote.lines.at(-1)).toEqual({ kind: 'credit_applied', amount: -25_000 });
  });

  it('gives a month paid ahead back as a line (D11)', () => {
    const quote = quotePlanChange({
      oldMonthly: BASIC,
      newMonthly: PRO,
      period: NOVEMBER,
      day: HALFWAY,
      creditBalance: 0,
      prepaidMonth: BASIC,
    });
    expect(quote.lines).toContainEqual({ kind: 'prepaid_month', amount: -BASIC });
    expect(quote).toMatchObject({ total: 0, creditAdded: 75_000 });
  });

  it('adds money owed after a void as its own line, never hidden in the total', () => {
    const quote = quoteRenewal(BASIC, -25_000);
    expect(quote.lines).toContainEqual({ kind: 'owed', amount: 25_000 });
    expect(quote).toMatchObject({ total: 125_000, owedCleared: 25_000 });
  });

  it('every bill’s lines add up to its total', () => {
    for (const quote of [
      quotePlanChange({ oldMonthly: BASIC, newMonthly: PRO, period: NOVEMBER, day: HALFWAY, creditBalance: 7_000 }),
      quoteRenewal(PRO, -3_000),
      quoteMonth(BASIC, 1_000),
    ]) {
      expect(quote.lines.reduce((sum, line) => sum + line.amount, 0)).toBe(quote.total);
    }
  });
});

describe('a renewal after expiry (D10)', () => {
  it('charges the grace and hold days the organization had, at the old plan’s daily rate', () => {
    const quote = quoteRenewal(BASIC, 0, { days: 7, oldMonthly: BASIC, oldPeriod: NOVEMBER });
    expect(quote.lines).toEqual([
      { kind: 'month', amount: BASIC },
      { kind: 'access_used', amount: prorate(BASIC, 7, 30), days: 7 },
    ]);
  });
});

describe('credit an organization is owed', () => {
  it('⚠ an upgrade approved days after it was priced returns the difference for those days (D12)', () => {
    const change = { oldMonthly: BASIC, newMonthly: PRO, period: NOVEMBER };
    expect(approvalLagCredit(change, HALFWAY, HALFWAY)).toBe(0);
    expect(approvalLagCredit(change, HALFWAY, '2026-11-21')).toBe(prorate(PRO - BASIC, 5, 30));
  });

  it('a downgrade earns no lag credit: its credit is worked out at approval', () => {
    expect(approvalLagCredit({ oldMonthly: PRO, newMonthly: BASIC, period: NOVEMBER }, HALFWAY, '2026-11-21')).toBe(0);
  });

  it('archiving a plan credits the paid days from the archive date', () => {
    expect(archiveCredit(BASIC, NOVEMBER, '2026-11-13')).toBe(prorate(BASIC, 18, 30));
    expect(archiveCredit(BASIC, NOVEMBER, '2026-12-01')).toBe(0);
  });
});
