import { type PrinterReceiptLine, type ReceiptPick, type ReceiptPrinterChoice, zonedDayKey } from '@kwtech/module-kit';
import type { PosOrderView } from '../pos-client.js';
import { formatPercent, formatPeso } from './money.js';
import { METHOD_LABELS } from './receipt.js';
import { lineLabel } from './till.js';

/**
 * A sale as a receipt printer's lines (#144, R5): what `receiptHtml` prints
 * in the browser, as text for a thermal roll. The binder lays it out for the
 * printer's width and turns it into its commands; this never sees a byte.
 *
 * ⚠ A REPRINT SAYS SO, with the time (guard rules), and NEVER OPENS THE
 * DRAWER: a copy must never pass for the original, nor hand out the till.
 * The original of a cash sale opens it, where a drawer is plugged in.
 */
export function receiptLines(
  order: PosOrderView,
  options: { timeZone: string; storeName?: string | null; reprintedAt?: Date | null },
): PrinterReceiptLine[] {
  const when = (iso: string) =>
    new Date(iso).toLocaleString('en-PH', { timeZone: options.timeZone, dateStyle: 'medium', timeStyle: 'short' });
  const title = order.status === 'unpaid' ? 'ORDER SLIP - UNPAID' : 'RECEIPT';
  const out: PrinterReceiptLine[] = [];

  if (options.storeName)
    out.push({ kind: 'text', text: options.storeName, align: 'center', bold: true, size: 'double' });
  out.push({
    kind: 'text',
    text: order.number !== null ? `${title} #${order.number}` : title,
    align: 'center',
    bold: true,
  });
  out.push({ kind: 'text', text: when(order.paidAt ?? order.finalisedAt ?? order.createdAt), align: 'center' });
  // How it was served, as copied onto the order: a renamed type never changes a receipt.
  if (order.orderTypeName) out.push({ kind: 'text', text: order.orderTypeName, align: 'center' });
  if (order.label) out.push({ kind: 'text', text: `Order ref: ${order.label}`, align: 'center', bold: true });
  if (order.customerName) {
    const contact = order.customerContact ? ` - ${order.customerContact}` : '';
    out.push({ kind: 'text', text: `${order.customerName}${contact}`, align: 'center' });
  }
  if (options.reprintedAt) {
    out.push({
      kind: 'text',
      text: `REPRINT - ${when(options.reprintedAt.toISOString())}`,
      align: 'center',
      bold: true,
    });
  }
  out.push({ kind: 'divider' });

  for (const line of order.lines) {
    out.push({ kind: 'pair', left: lineLabel(line), right: receiptMoney(line.gross) });
    out.push({ kind: 'text', text: `  ${line.quantity} x ${receiptMoney(line.unitPrice)}` });
    if (line.discount) {
      const what = line.discount.kind === 'percent' ? formatPercent(line.discount.value) : 'Discount';
      out.push({
        kind: 'pair',
        left: `  ${what} (${line.discount.reason})`,
        right: `-${receiptMoney(line.discountAmount)}`,
      });
    }
    if (line.note) out.push({ kind: 'text', text: `  Note: ${line.note}` });
  }
  out.push({ kind: 'divider' });

  out.push({ kind: 'pair', left: 'Subtotal', right: receiptMoney(order.subtotal) });
  if (order.orderDiscount > 0) {
    out.push({
      kind: 'pair',
      left: `Discount (${order.discount?.reason ?? ''})`,
      right: `-${receiptMoney(order.orderDiscount)}`,
    });
  }
  out.push({ kind: 'pair', left: 'TOTAL', right: receiptMoney(order.total), bold: true });
  out.push(...paymentLines(order));

  out.push({ kind: 'feed' });
  out.push({ kind: 'text', text: 'Thank you!', align: 'center' });
  out.push({ kind: 'cut' });
  if (!options.reprintedAt && order.status === 'paid' && order.paymentMethod === 'cash') out.push({ kind: 'drawer' });
  return out;
}

/** What was paid and how, or for an unpaid slip what is still to pay: `receiptHtml`'s rows. */
function paymentLines(order: PosOrderView): PrinterReceiptLine[] {
  if (order.status === 'unpaid')
    return [{ kind: 'pair', left: 'To pay', right: receiptMoney(order.total), bold: true }];
  if (order.status !== 'paid' || !order.paymentMethod) return [];
  const out: PrinterReceiptLine[] = [
    {
      kind: 'pair',
      left: METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod,
      right: receiptMoney(order.received ?? 0),
    },
  ];
  if ((order.change ?? 0) > 0) out.push({ kind: 'pair', left: 'Change', right: receiptMoney(order.change ?? 0) });
  if (order.tip > 0) out.push({ kind: 'pair', left: 'Thank you (tip)', right: receiptMoney(order.tip) });
  if (order.changeOwed > 0)
    out.push({ kind: 'pair', left: 'Change owed to you', right: receiptMoney(order.changeOwed) });
  if (order.paymentReference) out.push({ kind: 'pair', left: 'Reference', right: order.paymentReference });
  return out;
}

/**
 * A peso on a roll: "PHP 1,500.00". A receipt printer's character table has
 * no "₱"; spelling it out reads better than what folding it would leave.
 */
export function receiptMoney(centavos: number): string {
  return formatPeso(centavos).replace('₱', 'PHP ');
}

/**
 * Where a receipt will print, under the button: "on Counter 2 · Online".
 * Only an online printer is ever picked (`module-print`'s rule): one offline
 * makes it ask, and the line says why instead.
 */
export function receiptTargetText(printer: ReceiptPrinterChoice | null): string {
  if (!printer) return 'Choose a receipt printer.';
  return `on ${printer.name} · Online`;
}

/**
 * One receipt printer in the menu: its computer, width and default, and
 * whether it is online — offline, since when (in the workspace's zone; today
 * as a time, before that with the date).
 *
 * `statusFirst`: a phone's row cuts a long detail short, so its status leads
 * ("Offline since 9:02 PM · Front desk PC · 80 mm"), where it is never cut.
 */
export function receiptPrinterDetail(
  printer: ReceiptPrinterChoice,
  timeZone: string,
  now: Date,
  options: { statusFirst?: boolean } = {},
): string {
  const parts = [printer.computer, `${printer.paperWidth} mm`];
  if (printer.isDefault) parts.push('workspace default');
  const status = receiptPrinterStatus(printer, timeZone, now);
  return (options.statusFirst ? [status, ...parts] : [...parts, status]).join(' · ');
}

/** "Online", "Offline", or "Offline since 9:02 PM" (a date before today). */
function receiptPrinterStatus(printer: ReceiptPrinterChoice, timeZone: string, now: Date): string {
  if (printer.blocked === null) return 'Online';
  if (!printer.offlineSince) return 'Offline';
  const since = new Date(printer.offlineSince);
  const said =
    zonedDayKey(since, timeZone) === zonedDayKey(now, timeZone)
      ? since.toLocaleTimeString('en-PH', { timeZone, timeStyle: 'short' })
      : since.toLocaleString('en-PH', { timeZone, dateStyle: 'medium', timeStyle: 'short' });
  return `Offline since ${said}`;
}

/** The printer a receipt goes to now, or null when it asks. */
export function pickedReceiptPrinter(
  printers: readonly ReceiptPrinterChoice[],
  pick: ReceiptPick,
): ReceiptPrinterChoice | null {
  if (pick.kind === 'ask') return null;
  return printers.find((printer) => printer.id === pick.printerId) ?? null;
}
