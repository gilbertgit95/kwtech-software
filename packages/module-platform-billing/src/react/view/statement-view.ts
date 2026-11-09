import type { BillingStatementEntryView, BillingStatementView } from '../billing-client.js';
import { billStatusLabel, formatDay, formatMoney } from './billing-view.js';

/**
 * THE STATEMENT OF ACCOUNT, as words and as a CSV (plan §7). Pure: the page
 * prints what these say, and the download is these same lines.
 */

/** What a credit entry's kind means, for people. */
function creditWords(kind: string): string {
  switch (kind) {
    case 'overpayment':
      return 'Overpayment, kept as credit';
    case 'change_credit':
      return 'Unused days of a plan change';
    case 'credit_used':
      return 'Credit applied to a bill';
    case 'owed_cleared':
      return 'Amount owed, paid';
    case 'approval_lag':
      return 'Days between pricing and approval, given back';
    case 'closed_as_credit':
      return 'Payment kept as credit';
    case 'archive':
      return 'Paid days of a withdrawn plan';
    case 'archive_reversal':
      return 'Plan offered again: its credit taken back';
    case 'void_reversal':
      return 'Reversed with a voided receipt';
    case 'adjustment':
      return 'Adjustment by our staff';
    case 'paid_ahead':
      return 'Months paid ahead, kept as credit';
    default:
      return kind;
  }
}

/** One statement line as a sentence: what the document or entry was. */
export function statementLineLabel(
  entry: Pick<BillingStatementEntryView, 'kind' | 'number' | 'detail' | 'note'>,
): string {
  switch (entry.kind) {
    case 'bill':
      return `Bill ${entry.number ?? ''} (${billStatusLabel(entry.detail).toLowerCase()})`;
    case 'receipt':
      return entry.detail === 'void'
        ? `Receipt ${entry.number ?? ''} (void)`
        : entry.detail === 'closed_as_credit'
          ? `Receipt ${entry.number ?? ''} (payment kept as credit)`
          : entry.detail === 'paid_from_credit'
            ? `Receipt ${entry.number ?? ''} (renewed automatically, paid from credit)`
            : `Receipt ${entry.number ?? ''}`;
    default:
      return entry.note ?? creditWords(entry.detail);
  }
}

/** A CSV field: quoted, with quotes doubled, so a note with a comma stays one column. */
export function csvField(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/** Centavos as a plain decimal for a spreadsheet (`1000.50`), never a currency-formatted string. */
export function csvDecimal(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

/**
 * The statement as CSV (RFC 4180, CRLF): a header, then one row per line
 * with its day, what it was, the amounts and the running credit, then the
 * totals. Amounts are plain decimals in the statement's currency.
 */
export function statementCsv(statement: BillingStatementView): string {
  const rows: string[][] = [
    ['Day', 'Item', 'Billed', 'Paid', 'Credit', 'Credit balance'],
    ['', `Opening credit (${statement.currency})`, '', '', '', csvDecimal(statement.openingCredit)],
    ...statement.entries.map((entry) => [
      entry.day,
      statementLineLabel(entry),
      entry.billed ? csvDecimal(entry.billed) : '',
      entry.paid ? csvDecimal(entry.paid) : '',
      entry.credit ? csvDecimal(entry.credit) : '',
      csvDecimal(entry.creditBalance),
    ]),
    ['', 'Totals', csvDecimal(statement.billed), csvDecimal(statement.paid), '', csvDecimal(statement.closingCredit)],
  ];
  return `${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`;
}

/** The statement's file name: `statement-2026-11-01-to-2026-11-30.csv`. */
export function statementFileName(statement: Pick<BillingStatementView, 'from' | 'to'>): string {
  return `statement-${statement.from}-to-${statement.to}.csv`;
}

/** The statement's heading line: `1 Nov 2026 – 30 Nov 2026`. */
export function statementRange(statement: Pick<BillingStatementView, 'from' | 'to'>): string {
  return `${formatDay(statement.from)} – ${formatDay(statement.to)}`;
}

/** Money in the statement's currency. */
export function statementMoney(statement: Pick<BillingStatementView, 'currency'>, centavos: number): string {
  return formatMoney(centavos, statement.currency);
}

/** The first and last day of the month `today` falls in: the statement's default range. */
export function monthOf(today: string): { from: string; to: string } {
  const [year = '1970', month = '01'] = today.split('-');
  const last = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return { from: `${year}-${month}-01`, to: `${year}-${month}-${String(last).padStart(2, '0')}` };
}
