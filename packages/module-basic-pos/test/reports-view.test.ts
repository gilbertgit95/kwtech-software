import { zonedDayKey } from '@kwtech/module-kit';
import type { PosReportView, PosSummaryView } from '../src/react/pos-client.js';
import {
  ageText,
  bucketDays,
  chartPoints,
  compare,
  comparisonText,
  csvFileName,
  deltaText,
  hourText,
  kpis,
  margin,
  periodLabel,
  prepareCustomDays,
  presetDays,
  reportCsvRows,
  staffLabel,
  stepPeriod,
  summaryHtml,
  summaryLines,
  toCsv,
} from '../src/react/view/reports.js';

const NONE = { count: 0, amount: 0 };

const SUMMARY: PosSummaryView = {
  orders: 4,
  gross: 110_000,
  discounts: 10_000,
  refunds: 5_000,
  netSales: 95_000,
  averageOrder: 25_000,
  tips: 2_000,
  cash: 60_000,
  ewallet: 30_000,
  card: 5_000,
  cashExpected: 60_000,
  profit: 40_000,
  costCoverage: 8_000,
  unpaidReleased: { count: 1, amount: 7_500 },
  unpaidCollected: NONE,
  changeOwedOutstanding: NONE,
  cancelled: NONE,
};

function report(over: Partial<PosReportView> = {}): PosReportView {
  return {
    fromDay: '2026-09-30',
    toDay: '2026-09-30',
    timeZone: 'Asia/Manila',
    summary: SUMMARY,
    previous: { ...SUMMARY, orders: 2, netSales: 50_000, averageOrder: 25_000, profit: null },
    previousFromDay: '2026-09-23',
    previousToDay: '2026-09-23',
    granularity: 'day',
    series: [],
    previousSeries: [],
    byItem: [],
    byCategory: [],
    byStaff: [],
    byHour: [],
    unpaid: [],
    changeOwed: [],
    truncated: false,
    ...over,
  };
}

describe('presetDays', () => {
  // Wednesday 30 September 2026.
  const today = '2026-09-30';

  it('starts a week on Monday, a month on the 1st and a year on 1 January', () => {
    expect(presetDays('today', today)).toEqual({ fromDay: today, toDay: today });
    expect(presetDays('yesterday', today)).toEqual({ fromDay: '2026-09-29', toDay: '2026-09-29' });
    expect(presetDays('week', today)).toEqual({ fromDay: '2026-09-28', toDay: today });
    expect(presetDays('month', today)).toEqual({ fromDay: '2026-09-01', toDay: today });
    expect(presetDays('year', today)).toEqual({ fromDay: '2026-01-01', toDay: today });
  });

  it('keeps a Sunday in the week that began the Monday before, and a Monday on itself', () => {
    expect(presetDays('week', '2026-10-04').fromDay).toBe('2026-09-28');
    expect(presetDays('week', '2026-09-28').fromDay).toBe('2026-09-28');
  });

  it('crosses a month and a year back for yesterday', () => {
    expect(presetDays('yesterday', '2026-01-01')).toEqual({ fromDay: '2025-12-31', toDay: '2025-12-31' });
  });

  it("takes today from the WORKSPACE's zone: 17:00Z on the 30th is already the 1st in Manila", () => {
    const instant = new Date('2026-09-30T17:00:00Z');
    expect(presetDays('today', zonedDayKey(instant, 'Asia/Manila')).fromDay).toBe('2026-10-01');
    expect(presetDays('today', zonedDayKey(instant, 'Europe/London')).fromDay).toBe('2026-09-30');
  });
});

describe('the wider presets', () => {
  // Wednesday 30 September 2026.
  const today = '2026-09-30';

  it('makes last week the whole Monday to Sunday before, and last month the whole month before', () => {
    expect(presetDays('lastWeek', today)).toEqual({ fromDay: '2026-09-21', toDay: '2026-09-27' });
    expect(presetDays('lastMonth', today)).toEqual({ fromDay: '2026-08-01', toDay: '2026-08-31' });
    expect(presetDays('lastMonth', '2026-03-31')).toEqual({ fromDay: '2026-02-01', toDay: '2026-02-28' });
    expect(presetDays('lastMonth', '2026-01-15')).toEqual({ fromDay: '2025-12-01', toDay: '2025-12-31' });
  });

  it('counts the last 7 and 30 days back from today, today included', () => {
    expect(presetDays('last7', today)).toEqual({ fromDay: '2026-09-24', toDay: today });
    expect(presetDays('last30', today)).toEqual({ fromDay: '2026-09-01', toDay: today });
  });
});

describe('periodLabel', () => {
  const today = '2026-09-30';

  it('names a period by the preset it is, however it was reached', () => {
    expect(periodLabel({ fromDay: today, toDay: today }, today)).toBe('Today');
    expect(periodLabel({ fromDay: '2026-09-29', toDay: '2026-09-29' }, today)).toBe('Yesterday');
    expect(periodLabel({ fromDay: '2026-08-01', toDay: '2026-08-31' }, today)).toBe('Last month');
    expect(periodLabel({ fromDay: '2026-07-01', toDay: '2026-07-31' }, today)).toBe('Custom');
  });
});

describe('stepPeriod', () => {
  // Wednesday 30 September 2026.
  const today = '2026-09-30';

  it('moves a day by a day, and has no day after today', () => {
    expect(stepPeriod({ fromDay: today, toDay: today }, -1, today)).toEqual({
      fromDay: '2026-09-29',
      toDay: '2026-09-29',
    });
    expect(stepPeriod({ fromDay: '2026-09-29', toDay: '2026-09-29' }, 1, today)).toEqual({
      fromDay: today,
      toDay: today,
    });
    expect(stepPeriod({ fromDay: today, toDay: today }, 1, today)).toBeNull();
  });

  it('never jumps a week from a today that is a Monday', () => {
    expect(stepPeriod({ fromDay: '2026-09-28', toDay: '2026-09-28' }, -1, '2026-09-28')).toEqual({
      fromDay: '2026-09-27',
      toDay: '2026-09-27',
    });
  });

  it('moves this week, still running, to the whole week before, and back up to today', () => {
    const lastWeek = { fromDay: '2026-09-21', toDay: '2026-09-27' };
    expect(stepPeriod(presetDays('week', today), -1, today)).toEqual(lastWeek);
    expect(stepPeriod(lastWeek, 1, today)).toEqual({ fromDay: '2026-09-28', toDay: today });
    expect(stepPeriod(presetDays('week', today), 1, today)).toBeNull();
  });

  it('moves a month by a month at its own length, across a year', () => {
    expect(stepPeriod({ fromDay: '2026-03-01', toDay: '2026-03-31' }, -1, today)).toEqual({
      fromDay: '2026-02-01',
      toDay: '2026-02-28',
    });
    expect(stepPeriod({ fromDay: '2026-01-01', toDay: '2026-01-31' }, -1, today)).toEqual({
      fromDay: '2025-12-01',
      toDay: '2025-12-31',
    });
    expect(stepPeriod({ fromDay: '2026-08-01', toDay: '2026-08-31' }, 1, today)).toEqual({
      fromDay: '2026-09-01',
      toDay: today,
    });
    expect(stepPeriod(presetDays('month', '2026-09-16'), -1, '2026-09-16')).toEqual({
      fromDay: '2026-08-01',
      toDay: '2026-08-31',
    });
  });

  it('moves a year by a year, stopping at today', () => {
    expect(stepPeriod(presetDays('year', today), -1, today)).toEqual({ fromDay: '2025-01-01', toDay: '2025-12-31' });
    expect(stepPeriod({ fromDay: '2025-01-01', toDay: '2025-12-31' }, 1, today)).toEqual({
      fromDay: '2026-01-01',
      toDay: today,
    });
  });

  it('moves any other period by its own length', () => {
    expect(stepPeriod({ fromDay: '2026-09-10', toDay: '2026-09-14' }, -1, today)).toEqual({
      fromDay: '2026-09-05',
      toDay: '2026-09-09',
    });
    expect(stepPeriod(presetDays('last7', today), -1, today)).toEqual({ fromDay: '2026-09-17', toDay: '2026-09-23' });
    expect(stepPeriod({ fromDay: '2026-09-20', toDay: '2026-09-26' }, 1, today)).toEqual({
      fromDay: '2026-09-27',
      toDay: today,
    });
  });
});

describe('prepareCustomDays', () => {
  it('accepts a period, and refuses what the server would refuse, saying why', () => {
    expect(prepareCustomDays('2026-09-01', '2026-09-30')).toEqual({ fromDay: '2026-09-01', toDay: '2026-09-30' });
    expect(prepareCustomDays('', '2026-09-30')).toEqual({ problem: 'Choose both days.' });
    expect(prepareCustomDays('2026-02-30', '2026-03-01')).toEqual({ problem: 'Choose both days.' });
    expect(prepareCustomDays('2026-09-30', '2026-09-01')).toEqual({ problem: 'The last day is before the first.' });
    expect(prepareCustomDays('2024-01-01', '2026-01-01')).toEqual({ problem: 'A report covers at most 400 days.' });
  });
});

describe('comparing', () => {
  it('has no percentage from nothing, rather than an infinite or invented one', () => {
    expect(compare(150, 100)).toEqual({ direction: 'up', basisPoints: 5000 });
    expect(compare(75, 100)).toEqual({ direction: 'down', basisPoints: -2500 });
    expect(compare(100, 0)).toEqual({ direction: 'up', basisPoints: null });
    expect(compare(0, 0)).toEqual({ direction: 'flat', basisPoints: null });
    expect(deltaText(compare(150, 100))).toBe('▲ 50%');
    expect(deltaText(compare(75, 100))).toBe('▼ 25%');
    expect(deltaText(compare(100, 0))).toBe('new');
    expect(deltaText(compare(5, 5))).toBe('no change');
  });

  it('compares a loss against a loss by its size', () => {
    expect(compare(-50, -100)).toEqual({ direction: 'up', basisPoints: 5000 });
  });

  it('names the same weekday last week for a day, and the days before otherwise', () => {
    expect(comparisonText(report())).toBe('vs Wed, Sep 23');
    expect(comparisonText(report({ fromDay: '2026-09-01', toDay: '2026-09-30', previousFromDay: '2026-08-02' }))).toBe(
      'vs the 30 days before',
    );
  });

  it('shows profit only when some sold line had a cost', () => {
    expect(kpis(report()).map((card) => card.key)).toEqual(['netSales', 'orders', 'averageOrder', 'profit']);
    expect(kpis(report({ summary: { ...SUMMARY, profit: null } })).map((card) => card.key)).toEqual([
      'netSales',
      'orders',
      'averageOrder',
    ]);
    expect(kpis(report())[0]).toMatchObject({ value: '₱950.00', delta: { direction: 'up', basisPoints: 9000 } });
  });
});

describe('chartPoints', () => {
  it('fills every day of the period and lines the previous period up by position', () => {
    const points = chartPoints(
      report({
        fromDay: '2026-09-01',
        toDay: '2026-09-03',
        previousFromDay: '2026-08-29',
        previousToDay: '2026-08-31',
        series: [{ key: '2026-09-02', orders: 2, sales: 5_000, refunds: 0 }],
        previousSeries: [{ key: '2026-08-29', orders: 1, sales: 1_000, refunds: 0 }],
      }),
    );
    expect(points.map((point) => [point.key, point.sales, point.previousSales])).toEqual([
      ['2026-09-01', 0, 1_000],
      ['2026-09-02', 5_000, 0],
      ['2026-09-03', 0, 0],
    ]);
    expect(points[1]?.label).toBe('Wed, Sep 2');
  });

  it('buckets by month, and leaves no previous value past the shorter period', () => {
    const points = chartPoints(
      report({
        fromDay: '2026-01-01',
        toDay: '2026-03-15',
        previousFromDay: '2025-10-18',
        previousToDay: '2025-12-31',
        granularity: 'month',
        series: [{ key: '2026-02', orders: 3, sales: 9_000, refunds: 0 }],
        previousSeries: [],
      }),
    );
    expect(points.map((point) => point.key)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(points.map((point) => point.previousSales)).toEqual([0, 0, 0]);
    expect(points[1]).toMatchObject({ sales: 9_000, label: 'Feb 2026' });

    const longer = chartPoints(
      report({
        fromDay: '2026-01-01',
        toDay: '2026-03-15',
        previousFromDay: '2025-12-01',
        previousToDay: '2025-12-31',
        granularity: 'month',
      }),
    );
    expect(longer.map((point) => point.previousSales)).toEqual([0, null, null]);
  });

  it('opens a day from a day column, and a month clipped to the report from a month column', () => {
    const period = { fromDay: '2026-01-15', toDay: '2026-03-10' };
    expect(bucketDays('2026-02-03', period)).toEqual({ fromDay: '2026-02-03', toDay: '2026-02-03' });
    expect(bucketDays('2026-01', period)).toEqual({ fromDay: '2026-01-15', toDay: '2026-01-31' });
    expect(bucketDays('2026-02', period)).toEqual({ fromDay: '2026-02-01', toDay: '2026-02-28' });
    expect(bucketDays('2026-03', period)).toEqual({ fromDay: '2026-03-01', toDay: '2026-03-10' });
  });

  it('reads hours as a person does', () => {
    expect([0, 9, 12, 13, 23].map(hourText)).toEqual(['12 AM', '9 AM', '12 PM', '1 PM', '11 PM']);
  });
});

describe('the tables', () => {
  it('has a margin only with a profit and sales to divide by', () => {
    expect(margin({ net: 10_000, profit: 2_500 })).toBe(2500);
    expect(margin({ net: 10_000, profit: null })).toBeNull();
    expect(margin({ net: 0, profit: 0 })).toBeNull();
  });

  it('names staff the directory did not know, rather than a blank row', () => {
    expect(staffLabel({ key: 'u1', label: 'Ana' })).toBe('Ana');
    expect(staffLabel({ key: 'u1', label: '' })).toBe('Former member');
    expect(staffLabel({ key: '', label: '' })).toBe('Unknown');
  });

  it('says how long something has been owed', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    expect(ageText('2026-09-30T11:30:00Z', now)).toBe('under an hour');
    expect(ageText('2026-09-30T09:00:00Z', now)).toBe('3 hours');
    expect(ageText('2026-09-29T11:00:00Z', now)).toBe('1 day');
    expect(ageText('2026-09-20T12:00:00Z', now)).toBe('10 days');
  });

  it('writes every line of the daily summary, discounts and refunds as what they take off', () => {
    const lines = summaryLines(SUMMARY);
    expect(lines.find((line) => line.label === 'Discounts')?.value).toBe('-₱100.00');
    expect(lines.find((line) => line.label === 'Net sales')).toMatchObject({ value: '₱950.00', strong: true });
    expect(lines.find((line) => line.label === 'Profit')?.value).toBe('₱400.00 (costs cover 80% of sales)');
    expect(summaryLines({ ...SUMMARY, profit: null }).find((line) => line.label === 'Profit')?.value).toBe(
      'No costs entered',
    );
  });

  it('prints the summary with the period and when it was printed, in the store zone', () => {
    const html = summaryHtml(report(), new Date('2026-09-30T16:30:00Z'), 'Asia/Manila');
    expect(html).toContain('Sep 30, 2026');
    expect(html).toContain('Oct 1, 2026');
    expect(html).toContain('Cash that should be in the drawer');
  });
});

describe('CSV', () => {
  it('quotes what needs quoting, and starts with a BOM so Excel reads UTF-8', () => {
    expect(toCsv([['Peña', 'a,b', 'say "hi"', 'two\nlines', 3, null]])).toBe(
      '﻿Peña,"a,b","say ""hi""","two\nlines",3,\r\n',
    );
  });

  it('defuses text that a spreadsheet would run as a formula, and leaves numbers alone', () => {
    const csv = toCsv([['=HYPERLINK("x")', '+1', '-2', '@SUM(A1)', -150]]);
    expect(csv).toBe('﻿"\'=HYPERLINK(""x"")",\'+1,\'-2,\'@SUM(A1),-150\r\n');
  });

  it('writes a breakdown in pesos with its margin, and names the file by the period', () => {
    const rows = reportCsvRows(
      'item',
      report({
        byItem: [{ key: 'a', label: 'Lamination — A4', quantity: 3, net: 15_050, cost: 6_000, profit: 9_050 }],
      }),
      new Date(),
    );
    expect(rows).toEqual([
      ['Item', 'Quantity', 'Net sales (PHP)', 'Cost (PHP)', 'Profit (PHP)', 'Margin (%)'],
      ['Lamination — A4', 3, 150.5, 60, 90.5, 60.13],
    ]);
    expect(csvFileName('item', report())).toBe('pos-by-item-2026-09-30_2026-09-30.csv');
    expect(csvFileName('summary', report())).toBe('pos-daily-summary-2026-09-30_2026-09-30.csv');
  });

  it('lists both directions of what is owed', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    const rows = reportCsvRows(
      'outstanding',
      report({
        unpaid: [{ orderId: 'o1', number: 12, customerName: 'Ana', amount: 7_500, since: '2026-09-28T12:00:00Z' }],
        changeOwed: [{ orderId: 'o2', number: 13, customerName: 'Ben', amount: 2_000, since: '2026-09-30T09:00:00Z' }],
      }),
      now,
    );
    expect(rows.slice(1)).toEqual([
      ['Customer owes the store', 12, 'Ana', 75, '2026-09-28T12:00:00Z', '2 days'],
      ['Store owes change', 13, 'Ben', 20, '2026-09-30T09:00:00Z', '3 hours'],
    ]);
  });
});
