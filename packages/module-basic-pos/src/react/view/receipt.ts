import type { PosOrderView } from '../pos-client.js';
import { formatPercent, formatPeso } from './money.js';
import { lineLabel } from './till.js';

/** The roll the browser's receipt is laid out for. Millimetres. */
export const RECEIPT_PAPER_MM = 80;

/**
 * Blank paper left on every edge of the browser's receipt (#160). Millimetres.
 * Printers cannot print their outer few millimetres: Epson's L-series inkjets
 * 3 mm on each edge, lasers about 4.2 mm, 80 mm thermal printers about 4 mm.
 * Less than this and an edge of the receipt is lost.
 */
export const RECEIPT_MARGIN_MM = 5;

/** The receipt's printed width: the paper less both margins. Millimetres. */
export const RECEIPT_CONTENT_MM = RECEIPT_PAPER_MM - 2 * RECEIPT_MARGIN_MM;

/**
 * A receipt as printable HTML (D4 of POS-PLAN §1: "printable from the
 * browser"). Pure, so what prints is tested; the till hands it to a hidden
 * frame and calls `print()`.
 *
 * ⚠ ESCAPED. Every name, note and label is text somebody typed; printed
 * unescaped, "<img onerror=…>" in a customer's name would run in the frame.
 *
 * ⚠ A REPRINT SAYS SO, with the date (guard rules): a copy must never pass for
 * the original.
 *
 * ⚠ THE PAGE HAS MARGINS ON EVERY EDGE (#160). A printer cannot print the
 * outer few millimetres of the paper; with `@page{margin:0}` the receipt began
 * about 2 mm from the edge and an inkjet cut its left side off (the top was
 * as close, and only the side had been noticed). The content is
 * {@link RECEIPT_CONTENT_MM} wide, so it fits the page box between the
 * margins and the right side is not pushed off instead. This is the browser's
 * print only: the print agent's raw path (`receiptLines`) never reads it.
 */
export function receiptHtml(
  order: PosOrderView,
  options: { timeZone: string; storeName?: string | null; reprintedAt?: Date | null; printedAt?: Date | null },
): string {
  const when = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString('en-PH', { timeZone: options.timeZone, dateStyle: 'medium', timeStyle: 'short' })
      : '';
  // ⚠ An open order is an ORDER SUMMARY (#163): `receiptLines`' rules, on paper from the browser.
  const summary = isOrderSummary(order);
  const title = receiptTitle(order).replace(' - ', ' — ');
  const row = (left: string, right: string, cls = '') =>
    `<tr class="${cls}"><td>${escapeHtml(left)}</td><td class="r">${escapeHtml(right)}</td></tr>`;

  const lines = order.lines
    .map((line) => {
      const parts = [
        row(lineLabel(line), formatPeso(line.gross)),
        row(`  ${line.quantity} × ${formatPeso(line.unitPrice)}`, '', 'muted'),
      ];
      if (line.discount) {
        const what = line.discount.kind === 'percent' ? formatPercent(line.discount.value) : 'Discount';
        parts.push(row(`  ${what} (${line.discount.reason})`, `−${formatPeso(line.discountAmount)}`, 'muted'));
      }
      if (line.note) parts.push(row(`  Note: ${line.note}`, '', 'muted'));
      return parts.join('');
    })
    .join('');

  const totals = [
    row('Subtotal', formatPeso(order.subtotal)),
    order.orderDiscount > 0
      ? row(`Discount (${order.discount?.reason ?? ''})`, `−${formatPeso(order.orderDiscount)}`)
      : '',
    row('TOTAL', formatPeso(order.total), 'total'),
  ].join('');

  const payment = paymentRows(order, row);

  // The order's own reference (issue #24: "table 5"), apart from a payment's reference further down.
  const reference = order.label ? `<p class="ref">Order ref: ${escapeHtml(order.label)}</p>` : '';
  // How it was served ("Dine-in"), as copied onto the order when set: a renamed type never changes a receipt.
  const orderType = order.orderTypeName ? `<p class="ref">${escapeHtml(order.orderTypeName)}</p>` : '';
  const customer = order.customerName
    ? `<p>${escapeHtml(order.customerName)}${order.customerContact ? ` · ${escapeHtml(order.customerContact)}` : ''}</p>`
    : '';
  const reprint =
    options.reprintedAt && !summary
      ? `<p class="reprint">REPRINT — ${escapeHtml(options.reprintedAt.toLocaleString('en-PH', { timeZone: options.timeZone }))}</p>`
      : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
body{font:12px/1.4 ui-monospace,Menlo,monospace;margin:0;padding:0;width:${RECEIPT_CONTENT_MM}mm;color:#000}
h1{font-size:14px;text-align:center;margin:0 0 4px}p{margin:0 0 4px;text-align:center}
table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}.r{text-align:right;white-space:nowrap}
.muted td{color:#444}.total td{font-weight:700;border-top:1px dashed #000;padding-top:3px}
.ref{font-weight:700}.reprint{font-weight:700;border:1px solid #000;padding:2px}hr{border:0;border-top:1px dashed #000}
@page{margin:${RECEIPT_MARGIN_MM}mm;size:${RECEIPT_PAPER_MM}mm auto}
</style></head><body>
${options.storeName ? `<h1>${escapeHtml(options.storeName)}</h1>` : ''}
<p>${escapeHtml(title)}${order.number !== null ? ` #${order.number}` : ''}</p>
${summary ? `<p class="reprint">${NOT_A_RECEIPT}</p>` : ''}
<p>${escapeHtml(when(receiptTime(order, options.printedAt)))}</p>
${orderType}${reference}${customer}${reprint}<hr>
<table>${lines}</table><hr><table>${totals}${payment}</table>
<p style="margin-top:8px">${summary ? SUMMARY_FOOTER : 'Thank you!'}</p>
</body></html>`;
}

/** What was paid and how — or, for an unpaid slip, what is still to pay. */
function paymentRows(order: PosOrderView, row: (left: string, right: string, cls?: string) => string): string {
  if (order.status === 'unpaid') return row('To pay', formatPeso(order.total), 'total');
  if (order.status !== 'paid' || !order.paymentMethod) return '';
  return [
    row(METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod, formatPeso(order.received ?? 0)),
    (order.change ?? 0) > 0 ? row('Change', formatPeso(order.change ?? 0)) : '',
    order.tip > 0 ? row('Thank you (tip)', formatPeso(order.tip)) : '',
    order.changeOwed > 0 ? row('Change owed to you', formatPeso(order.changeOwed)) : '',
    order.paymentReference ? row('Reference', order.paymentReference) : '',
  ].join('');
}

/**
 * Whether the order prints as an ORDER SUMMARY (#163): still open, so nothing
 * has been paid or released yet. Every other status prints as it always has.
 */
export function isOrderSummary(order: Pick<PosOrderView, 'status'>): boolean {
  return order.status === 'open';
}

/** The paper's title: an order summary, an unpaid order's slip, or a receipt. Plain ASCII, for a roll's character table. */
export function receiptTitle(order: Pick<PosOrderView, 'status'>): string {
  if (isOrderSummary(order)) return 'ORDER SUMMARY';
  return order.status === 'unpaid' ? 'ORDER SLIP - UNPAID' : 'RECEIPT';
}

/** Printed under an order summary's title, bold: it must never pass for proof of payment. */
export const NOT_A_RECEIPT = 'NOT A RECEIPT';

/** An order summary's last words, where a receipt says "Thank you!". */
export const SUMMARY_FOOTER = 'This is not a receipt.';

/**
 * The time under the title: when it was paid or released — or, for an order
 * summary, when it was PRINTED, since the order may still change after.
 */
export function receiptTime(
  order: Pick<PosOrderView, 'status' | 'paidAt' | 'finalisedAt' | 'createdAt'>,
  printedAt: Date | null | undefined,
): string {
  if (isOrderSummary(order) && printedAt) return printedAt.toISOString();
  return order.paidAt ?? order.finalisedAt ?? order.createdAt;
}

export const METHOD_LABELS: Readonly<Record<string, string>> = {
  cash: 'Cash',
  ewallet: 'E-wallet',
  card: 'Card',
};

/** Text somebody typed, made safe to print inside HTML. The receipt's, and the daily summary's. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (character) => `&#${character.charCodeAt(0)};`);
}
