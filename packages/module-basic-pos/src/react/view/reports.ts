import { POS_REPORT_DAYS_MAX, shiftDayKey } from '../../domain/reports.js';
import type {
  PosBreakdownRowView,
  PosOwedView,
  PosReportView,
  PosSeriesPointView,
  PosSummaryView,
} from '../pos-client.js';
import { formatPercent, formatPeso } from './money.js';
import { escapeHtml } from './receipt.js';

/**
 * The Reports section's decisions (D22), pure so they are tested rather than
 * hoped for. The server adds the figures up (`src/domain/reports.ts`); these
 * only pick the period, line the charts up, compare, and write the CSV — so
 * the page, the print and the CSV show the SAME numbers.
 *
 * ⚠ Every day here is a STORE day (`YYYY-MM-DD`) in the workspace's zone,
 * handed in as `today`. Nothing here reads the clock or the browser's zone.
 */

// ── the period ──────────────────────────────────────────────────────────────

export const REPORT_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'year', label: 'This year' },
  { key: 'custom', label: 'Custom' },
] as const;

export type ReportPreset = (typeof REPORT_PRESETS)[number]['key'];

export interface ReportDays {
  fromDay: string;
  toDay: string;
}

/**
 * A preset's store days, inclusive, up to `today`. A week starts on MONDAY,
 * as a Philippine store's week does, and as ISO's does.
 */
export function presetDays(preset: Exclude<ReportPreset, 'custom'>, today: string): ReportDays {
  switch (preset) {
    case 'today':
      return { fromDay: today, toDay: today };
    case 'yesterday': {
      const yesterday = shiftDayKey(today, -1);
      return { fromDay: yesterday, toDay: yesterday };
    }
    case 'week':
      return { fromDay: shiftDayKey(today, -((weekday(today) + 6) % 7)), toDay: today };
    case 'month':
      return { fromDay: `${today.slice(0, 7)}-01`, toDay: today };
    case 'year':
      return { fromDay: `${today.slice(0, 4)}-01-01`, toDay: today };
  }
}

/** 0 = Sunday … 6 = Saturday, of a day KEY (zone-free: the key already is the store's day). */
function weekday(dayKey: string): number {
  return new Date(`${dayKey}T00:00:00Z`).getUTCDay();
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/u;

function isDayKey(text: string): boolean {
  return DAY_KEY.test(text) && shiftDayKey(text, 0) === text;
}

/** Store days `fromDay`..`toDay`, inclusive. */
export function dayCount(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * A custom period as typed, or why not — the same rule the server applies
 * (`invalid_period`), said before the request rather than after it.
 */
export function prepareCustomDays(fromDay: string, toDay: string): ReportDays | { problem: string } {
  if (!isDayKey(fromDay) || !isDayKey(toDay)) return { problem: 'Choose both days.' };
  if (toDay < fromDay) return { problem: 'The last day is before the first.' };
  if (dayCount(fromDay, toDay) > POS_REPORT_DAYS_MAX) {
    return { problem: `A report covers at most ${POS_REPORT_DAYS_MAX} days.` };
  }
  return { fromDay, toDay };
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', dateStyle: 'medium' });
const SHORT_DAY_FORMAT = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const MONTH_FORMAT = new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', month: 'short', year: 'numeric' });

/**
 * A store day as a person reads it: "Sep 30, 2026". Formatted in UTC because a
 * day KEY is already the store's day — formatting it in any other zone could
 * move it by one.
 */
export function dayText(dayKey: string): string {
  return DAY_FORMAT.format(new Date(`${dayKey}T00:00:00Z`));
}

/** A period as one phrase: "Sep 30, 2026", or "Sep 1, 2026 – Sep 30, 2026". */
export function periodText(fromDay: string, toDay: string): string {
  return fromDay === toDay ? dayText(fromDay) : `${dayText(fromDay)} – ${dayText(toDay)}`;
}

/** What the KPI cards compare with (D22): "vs Tue, Sep 23" for a day, "vs the 7 days before" otherwise. */
export function comparisonText(report: Pick<PosReportView, 'fromDay' | 'toDay' | 'previousFromDay'>): string {
  if (report.fromDay === report.toDay) {
    return `vs ${SHORT_DAY_FORMAT.format(new Date(`${report.previousFromDay}T00:00:00Z`))}`;
  }
  const days = dayCount(report.fromDay, report.toDay);
  return `vs the ${days} days before`;
}

// ── comparing ───────────────────────────────────────────────────────────────

export interface Delta {
  direction: 'up' | 'down' | 'flat';
  /** The change in basis points, or null when the previous period had nothing to compare with. */
  basisPoints: number | null;
}

/**
 * This period against the previous one. From ₱0 there is no percentage —
 * "up ∞%" would be noise, and "up 100%" a lie — so it is `null`, shown as "new".
 */
export function compare(current: number, previous: number): Delta {
  const direction = current > previous ? 'up' : current < previous ? 'down' : 'flat';
  if (previous === 0) return { direction, basisPoints: null };
  return { direction, basisPoints: Math.round(((current - previous) * 10_000) / Math.abs(previous)) };
}

/** A delta as text: "▲ 12.5%", "▼ 3%", "no change", or "new" from nothing. */
export function deltaText(delta: Delta): string {
  if (delta.direction === 'flat') return 'no change';
  if (delta.basisPoints === null) return 'new';
  return `${delta.direction === 'up' ? '▲' : '▼'} ${formatPercent(Math.abs(delta.basisPoints))}`;
}

export interface Kpi {
  key: 'netSales' | 'orders' | 'averageOrder' | 'profit';
  label: string;
  value: string;
  delta: Delta;
}

/**
 * The dashboard's cards (D22): net sales, orders, average order — and profit
 * ONLY when some sold line had a cost: "no profit figure" is not "₱0 profit".
 */
export function kpis(report: Pick<PosReportView, 'summary' | 'previous'>): Kpi[] {
  const { summary: now, previous: before } = report;
  const cards: Kpi[] = [
    {
      key: 'netSales',
      label: 'Net sales',
      value: formatPeso(now.netSales),
      delta: compare(now.netSales, before.netSales),
    },
    { key: 'orders', label: 'Orders', value: String(now.orders), delta: compare(now.orders, before.orders) },
    {
      key: 'averageOrder',
      label: 'Average order',
      value: formatPeso(now.averageOrder),
      delta: compare(now.averageOrder, before.averageOrder),
    },
  ];
  if (now.profit === null) return cards;
  return [
    ...cards,
    { key: 'profit', label: 'Profit', value: formatPeso(now.profit), delta: compare(now.profit, before.profit ?? 0) },
  ];
}

// ── the charts ──────────────────────────────────────────────────────────────

export interface ChartPoint {
  /** The bucket's key: a day or a month of THIS period. */
  key: string;
  label: string;
  sales: number;
  orders: number;
  /** The comparison period's bucket at the same position, or null past its end. */
  previousSales: number | null;
  previousOrders: number | null;
}

/**
 * Every bucket of the period, gaps filled with zero (the server sends only
 * buckets with something in them), and the previous period lined up BY
 * POSITION: this month's 3rd day beside last month's 3rd day. `sales` are
 * order totals paid in the bucket, before refunds, as the server counts them.
 */
export function chartPoints(
  report: Pick<
    PosReportView,
    'fromDay' | 'toDay' | 'previousFromDay' | 'previousToDay' | 'granularity' | 'series' | 'previousSeries'
  >,
): ChartPoint[] {
  const month = report.granularity === 'month';
  const keys = bucketKeys(report.fromDay, report.toDay, month);
  const previousKeys = bucketKeys(report.previousFromDay, report.previousToDay, month);
  const current = new Map(report.series.map((point) => [point.key, point]));
  const previous = new Map(report.previousSeries.map((point) => [point.key, point]));
  return keys.map((key, index) => {
    const previousKey = previousKeys[index];
    const before: PosSeriesPointView | undefined = previousKey ? previous.get(previousKey) : undefined;
    return {
      key,
      label: month
        ? MONTH_FORMAT.format(new Date(`${key}-01T00:00:00Z`))
        : SHORT_DAY_FORMAT.format(new Date(`${key}T00:00:00Z`)),
      sales: current.get(key)?.sales ?? 0,
      orders: current.get(key)?.orders ?? 0,
      previousSales: previousKey ? (before?.sales ?? 0) : null,
      previousOrders: previousKey ? (before?.orders ?? 0) : null,
    };
  });
}

/** The day keys, or month keys, a period covers, in order. */
function bucketKeys(fromDay: string, toDay: string, month: boolean): string[] {
  const keys: string[] = [];
  for (let day = fromDay; day <= toDay; day = shiftDayKey(day, 1)) {
    const key = month ? day.slice(0, 7) : day;
    if (keys[keys.length - 1] !== key) keys.push(key);
  }
  return keys;
}

/** An hour of the store's day as a person reads it: 0 → "12 AM", 13 → "1 PM". */
export function hourText(hour: number): string {
  const suffix = hour < 12 ? 'AM' : 'PM';
  return `${hour % 12 === 0 ? 12 : hour % 12} ${suffix}`;
}

/** The period a chart column opens (D22): a day opens that day; a month, that month up to the report's end. */
export function bucketDays(key: string, report: Pick<PosReportView, 'fromDay' | 'toDay'>): ReportDays {
  if (key.length === 10) return { fromDay: key, toDay: key };
  const first = `${key}-01`;
  const last = shiftDayKey(`${shiftDayKey(first, 31).slice(0, 7)}-01`, -1);
  return { fromDay: first < report.fromDay ? report.fromDay : first, toDay: last > report.toDay ? report.toDay : last };
}

// ── the tables ──────────────────────────────────────────────────────────────

/** Profit ÷ net sales, in basis points; null without a profit, or with no sales to divide by. */
export function margin(row: Pick<PosBreakdownRowView, 'net' | 'profit'>): number | null {
  if (row.profit === null || row.net === 0) return null;
  return Math.round((row.profit * 10_000) / row.net);
}

/** A staff row's label: their name, or why there is none (the directory did not know them). */
export function staffLabel(row: Pick<PosBreakdownRowView, 'key' | 'label'>): string {
  if (row.label) return row.label;
  return row.key ? 'Former member' : 'Unknown';
}

/** How long something has been owed, as of `now`: "3 hours", "2 days". */
export function ageText(sinceIso: string, now: Date): string {
  const hours = Math.max(0, Math.floor((now.getTime() - Date.parse(sinceIso)) / 3_600_000));
  if (hours < 1) return 'under an hour';
  if (hours < 24) return hours === 1 ? '1 hour' : `${hours} hours`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day' : `${days} days`;
}

export interface SummaryLine {
  label: string;
  value: string;
  /** A total the eye should land on: net sales, the drawer. */
  strong?: boolean;
  /** Indented under the line before (the methods under "Received"). */
  indent?: boolean;
}

/**
 * The daily summary (D22, report 1), as labelled lines — one list for the
 * page, the print and the CSV, so none of them can drop a line the others
 * show. Discounts and refunds are written as what they take off.
 */
export function summaryLines(summary: PosSummaryView): SummaryLine[] {
  const countAmount = (entry: { count: number; amount: number }) => `${entry.count} · ${formatPeso(entry.amount)}`;
  return [
    { label: 'Orders', value: String(summary.orders) },
    { label: 'Gross sales', value: formatPeso(summary.gross) },
    { label: 'Discounts', value: formatPeso(-summary.discounts) },
    { label: 'Refunds', value: formatPeso(-summary.refunds) },
    { label: 'Net sales', value: formatPeso(summary.netSales), strong: true },
    { label: 'Average order', value: formatPeso(summary.averageOrder) },
    { label: 'Tips', value: formatPeso(summary.tips) },
    { label: 'Kept, by method', value: formatPeso(summary.cash + summary.ewallet + summary.card) },
    { label: 'Cash', value: formatPeso(summary.cash), indent: true },
    { label: 'E-wallet', value: formatPeso(summary.ewallet), indent: true },
    { label: 'Card', value: formatPeso(summary.card), indent: true },
    { label: 'Cash that should be in the drawer', value: formatPeso(summary.cashExpected), strong: true },
    {
      label: 'Profit',
      value:
        summary.profit === null
          ? 'No costs entered'
          : `${formatPeso(summary.profit)} (costs cover ${formatPercent(summary.costCoverage)} of sales)`,
    },
    { label: 'Pay later, released', value: countAmount(summary.unpaidReleased) },
    { label: 'Pay later, collected', value: countAmount(summary.unpaidCollected) },
    { label: 'Change owed, still outstanding', value: countAmount(summary.changeOwedOutstanding) },
    { label: 'Cancelled', value: countAmount(summary.cancelled) },
  ];
}

/**
 * The daily summary as printable HTML, for the drawer at closing. Handed to
 * the same hidden frame as a receipt. ⚠ ESCAPED: the store name is typed.
 */
export function summaryHtml(
  report: Pick<PosReportView, 'fromDay' | 'toDay' | 'summary'>,
  printedAt: Date,
  timeZone: string,
): string {
  const rows = summaryLines(report.summary)
    .map(
      (line) =>
        `<tr${line.strong ? ' class="b"' : ''}><td${line.indent ? ' class="i"' : ''}>${escapeHtml(line.label)}</td><td class="r">${escapeHtml(line.value)}</td></tr>`,
    )
    .join('');
  const printed = printedAt.toLocaleString('en-PH', { timeZone, dateStyle: 'medium', timeStyle: 'short' });
  return `<!doctype html><html><head><meta charset="utf-8"><title>Daily summary</title><style>
body{font:12px/1.4 system-ui,sans-serif;margin:16px;color:#000}h1{font-size:15px;margin:0}p{margin:2px 0 10px}
table{width:100%;border-collapse:collapse}td{padding:3px 0;border-bottom:1px solid #ddd}.r{text-align:right}
.b td{font-weight:700}.i{padding-left:16px}
</style></head><body><h1>Daily summary</h1><p>${escapeHtml(periodText(report.fromDay, report.toDay))} · printed ${escapeHtml(printed)}</p>
<table>${rows}</table></body></html>`;
}

// ── CSV (D22) ───────────────────────────────────────────────────────────────

export type CsvCell = string | number | null;

/**
 * Rows as CSV text: RFC 4180 quoting, CRLF, and a BOM so Excel reads UTF-8
 * (a customer named "Peña" must not come out as "PeÃ±a").
 *
 * ⚠ FORMULA INJECTION. An item or customer name is typed by staff, and a
 * cell starting `=`, `+`, `-`, `@`, tab or CR is run as a formula when the
 * file is opened in a spreadsheet. Such TEXT gets a leading `'`. Numbers are
 * never touched — a refund of −150 must stay a number.
 */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function csvCell(cell: CsvCell): string {
  if (cell === null) return '';
  if (typeof cell === 'number') return String(cell);
  const safe = /^[=+\-@\t\r]/u.test(cell) ? `'${cell}` : cell;
  return /[",\r\n]/u.test(safe) ? `"${safe.replace(/"/gu, '""')}"` : safe;
}

/** Centavos as a spreadsheet number of pesos: 150050 → 1500.5. Exact, because it is two decimals of an integer. */
function pesos(centavos: number | null): number | null {
  return centavos === null ? null : centavos / 100;
}

/** Basis points as a spreadsheet percentage number: 1250 → 12.5. */
function percent(basisPoints: number | null): number | null {
  return basisPoints === null ? null : basisPoints / 100;
}

export type ReportTable = 'summary' | 'item' | 'category' | 'staff' | 'hour' | 'outstanding';

/** The file a table downloads as: `pos-by-item-2026-09-01_2026-09-30.csv`. */
export function csvFileName(table: ReportTable, report: Pick<PosReportView, 'fromDay' | 'toDay'>): string {
  const name = table === 'summary' ? 'daily-summary' : table === 'outstanding' ? 'outstanding' : `by-${table}`;
  return `pos-${name}-${report.fromDay}_${report.toDay}.csv`;
}

/** One report table as CSV rows, header first — the same rows the page shows. */
export function reportCsvRows(table: ReportTable, report: PosReportView, now: Date): CsvCell[][] {
  switch (table) {
    case 'summary':
      return [['Figure', 'Value'], ...summaryLines(report.summary).map((line) => [line.label, line.value])];
    case 'item':
      return breakdownRows('Item', report.byItem);
    case 'category':
      // Already labelled: the server names a line with no category POS_UNCATEGORISED.
      return breakdownRows('Category', report.byCategory);
    case 'staff':
      return breakdownRows(
        'Staff',
        report.byStaff.map((row) => ({ ...row, label: staffLabel(row) })),
      );
    case 'hour':
      return [
        ['Hour', 'Orders', 'Sales (PHP)'],
        ...report.byHour.map((row) => [hourText(row.hour), row.orders, pesos(row.sales)]),
      ];
    case 'outstanding':
      return [
        ['Owed', 'Order', 'Customer', 'Amount (PHP)', 'Since', 'For'],
        ...owedRows('Customer owes the store', report.unpaid, now),
        ...owedRows('Store owes change', report.changeOwed, now),
      ];
  }
}

function breakdownRows(title: string, rows: readonly PosBreakdownRowView[]): CsvCell[][] {
  return [
    [title, 'Quantity', 'Net sales (PHP)', 'Cost (PHP)', 'Profit (PHP)', 'Margin (%)'],
    ...rows.map((row) => [
      row.label,
      row.quantity,
      pesos(row.net),
      pesos(row.cost),
      pesos(row.profit),
      percent(margin(row)),
    ]),
  ];
}

function owedRows(kind: string, rows: readonly PosOwedView[], now: Date): CsvCell[][] {
  return rows.map((row) => [kind, row.number, row.customerName, pesos(row.amount), row.since, ageText(row.since, now)]);
}
