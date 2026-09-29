import type { PosOrderView } from '../pos-client.js';
import { formatPercent, formatPeso } from './money.js';
import { lineLabel } from './till.js';

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
 */
export function receiptHtml(
  order: PosOrderView,
  options: { timeZone: string; storeName?: string | null; reprintedAt?: Date | null },
): string {
  const when = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString('en-PH', { timeZone: options.timeZone, dateStyle: 'medium', timeStyle: 'short' })
      : '';
  const title = order.status === 'unpaid' ? 'ORDER SLIP — UNPAID' : 'RECEIPT';
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

  const customer = order.customerName
    ? `<p>${escapeHtml(order.customerName)}${order.customerContact ? ` · ${escapeHtml(order.customerContact)}` : ''}</p>`
    : '';
  const reprint = options.reprintedAt
    ? `<p class="reprint">REPRINT — ${escapeHtml(options.reprintedAt.toLocaleString('en-PH', { timeZone: options.timeZone }))}</p>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
body{font:12px/1.4 ui-monospace,Menlo,monospace;margin:0;padding:8px;width:72mm;color:#000}
h1{font-size:14px;text-align:center;margin:0 0 4px}p{margin:0 0 4px;text-align:center}
table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}.r{text-align:right;white-space:nowrap}
.muted td{color:#444}.total td{font-weight:700;border-top:1px dashed #000;padding-top:3px}
.reprint{font-weight:700;border:1px solid #000;padding:2px}hr{border:0;border-top:1px dashed #000}
@page{margin:0;size:80mm auto}
</style></head><body>
${options.storeName ? `<h1>${escapeHtml(options.storeName)}</h1>` : ''}
<p>${escapeHtml(title)}${order.number !== null ? ` #${order.number}` : ''}</p>
<p>${escapeHtml(when(order.paidAt ?? order.finalisedAt ?? order.createdAt))}</p>
${customer}${reprint}<hr>
<table>${lines}</table><hr><table>${totals}${payment}</table>
<p style="margin-top:8px">Thank you!</p>
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

export const METHOD_LABELS: Readonly<Record<string, string>> = {
  cash: 'Cash',
  ewallet: 'E-wallet',
  card: 'Card',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (character) => `&#${character.charCodeAt(0)};`);
}
