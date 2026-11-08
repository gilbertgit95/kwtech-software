import type {
  BillingCollectedView,
  BillingOrganizationStandingView,
  BillingReportView,
} from '../billing-admin-client.js';
import { formatDay, paymentMethodLabel, standingWord } from './billing-view.js';
import { csvDecimal, csvField } from './statement-view.js';

/**
 * THE PLATFORM'S REPORTS AND STANDINGS, as tables and a CSV (phase 7b).
 * Pure: the page shows what these say, and the download is these same rows.
 */

/** A table of collections: one row per period, one column per method that appears, and the period's total. */
export interface CollectedTable {
  methods: string[];
  rows: Array<{ period: string; byMethod: Record<string, number>; total: number }>;
  /** Each method's total over the table, and the grand total. */
  totals: { byMethod: Record<string, number>; total: number };
}

/** `rows` (period × method) pivoted into a table, periods oldest first, methods in a stable order. */
export function collectedTable(rows: readonly BillingCollectedView[]): CollectedTable {
  const methods = [...new Set(rows.map((row) => row.method))].sort();
  const byPeriod = new Map<string, { period: string; byMethod: Record<string, number>; total: number }>();
  const totals = { byMethod: {} as Record<string, number>, total: 0 };
  for (const row of rows) {
    const line = byPeriod.get(row.period) ?? { period: row.period, byMethod: {}, total: 0 };
    line.byMethod[row.method] = (line.byMethod[row.method] ?? 0) + row.amount;
    line.total += row.amount;
    byPeriod.set(row.period, line);
    totals.byMethod[row.method] = (totals.byMethod[row.method] ?? 0) + row.amount;
    totals.total += row.amount;
  }
  return { methods, rows: [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period)), totals };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A period as people read it: a day `8 Nov 2026`, a month `Nov 2026`. */
export function periodLabel(period: string): string {
  const month = /^(\d{4})-(\d{2})$/.exec(period);
  if (!month) return formatDay(period);
  return `${MONTHS[Number(month[2]) - 1] ?? month[2]} ${month[1]}`;
}

/**
 * The collections as CSV (RFC 4180, CRLF): by day, one column per method
 * and the day's total, then the totals, then what each plan earned. Plain
 * decimal amounts in the report's currency.
 */
export function collectionsCsv(report: BillingReportView): string {
  const table = collectedTable(report.byDay);
  const rows: string[][] = [
    ['Day', ...table.methods.map(paymentMethodLabel), `Total (${report.currency})`],
    ...table.rows.map((row) => [
      row.period,
      ...table.methods.map((method) => (row.byMethod[method] ? csvDecimal(row.byMethod[method]) : '')),
      csvDecimal(row.total),
    ]),
    [
      'Totals',
      ...table.methods.map((method) => csvDecimal(table.totals.byMethod[method] ?? 0)),
      csvDecimal(table.totals.total),
    ],
    [],
    ['Plan', 'Receipts', `Collected (${report.currency})`],
    ...report.perPlan.map((plan) => [plan.planLabel, String(plan.receipts), csvDecimal(plan.amount)]),
  ];
  return `${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`;
}

/** The collections file's name: `collections-2026-11-01-to-2026-11-30.csv`. */
export function collectionsFileName(report: Pick<BillingReportView, 'from' | 'to'>): string {
  return `collections-${report.from}-to-${report.to}.csv`;
}

/** What one organization's standing says on the list, with the date it turns on. */
export function standingLine(
  one: Pick<BillingOrganizationStandingView, 'standing' | 'creditBalance' | 'pendingRequestId'>,
): { word: string; detail: string; tone: 'warning' | 'muted' | 'normal' } {
  const { standing } = one;
  const word =
    standing.cancelled && standing.kind !== 'expired' ? `${standingWord(standing)}, cancelled` : standingWord(standing);
  switch (standing.kind) {
    case 'active':
    case 'renewal_open':
      return { word, detail: standing.periodEnd ? `Due ${formatDay(standing.periodEnd)}` : '', tone: 'normal' };
    case 'overdue':
    case 'held':
      return {
        word,
        detail: standing.accessUntil ? `Access until ${formatDay(standing.accessUntil)}` : '',
        tone: 'warning',
      };
    case 'expired':
      return {
        word,
        detail: standing.accessUntil ? `Since ${formatDay(standing.accessUntil)}` : '',
        tone: 'warning',
      };
    default:
      return { word, detail: 'No paid plan', tone: 'muted' };
  }
}

/** The filters the organizations list offers, with their words. */
export const STANDING_FILTER_OPTIONS: ReadonlyArray<{ value: string | null; label: string }> = [
  { value: null, label: 'All' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'expired', label: 'Expired' },
  { value: 'credit', label: 'Credit or owed' },
  { value: 'pending', label: 'Request waiting' },
];

/** A standing kind in a count's words: `3 active`, `2 overdue, in grace`. */
export function standingKindWords(kind: string): string {
  switch (kind) {
    case 'active':
      return 'active';
    case 'renewal_open':
      return 'active, renewal open';
    case 'overdue':
      return 'overdue, in grace';
    case 'held':
      return 'overdue, access held';
    case 'expired':
      return 'expired';
    default:
      return 'without a paid plan';
  }
}
