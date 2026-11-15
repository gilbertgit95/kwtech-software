import type { PrintRefusal } from '../types.js';
import {
  RECEIPT_COLUMNS,
  RECEIPT_PAPER_WIDTHS,
  type ReceiptLine,
  type ReceiptPaperWidth,
  type ReceiptPrinterProfile,
} from './receipt.js';

/**
 * Which printers print receipts, and how (#144, R4 #148). A person marks a
 * printer as a receipt printer in the Printers app; the mark lives apart from
 * the printer's reported row (`PrintReceiptPrinter`), which every report
 * rewrites.
 */

/** The longest name for a printer's place ("Counter 1", "Kitchen"): a menu line, not a description. */
export const RECEIPT_PRINTER_LABEL_MAX = 40;

/** A receipt printer's settings, as a person chose them. */
export interface PrintReceiptSettings {
  /** The name people know it by. Null: its queue's name. */
  label: string | null;
  paperWidth: ReceiptPaperWidth;
  cutter: boolean;
  drawer: boolean;
  qr: boolean;
}

/** Receipt settings from a form or the wire, checked: or `{ refused }`. */
export function prepareReceiptSettings(raw: {
  label?: unknown;
  paperWidth: unknown;
  cutter: unknown;
  drawer: unknown;
  qr: unknown;
}): PrintReceiptSettings | { refused: PrintRefusal } {
  const label = typeof raw.label === 'string' ? raw.label.trim() : null;
  if (raw.label != null && typeof raw.label !== 'string') return { refused: 'invalid_receipt_settings' };
  if (label !== null && label.length > RECEIPT_PRINTER_LABEL_MAX) return { refused: 'invalid_receipt_settings' };
  if (!(RECEIPT_PAPER_WIDTHS as readonly unknown[]).includes(raw.paperWidth)) {
    return { refused: 'invalid_receipt_settings' };
  }
  if (typeof raw.cutter !== 'boolean' || typeof raw.drawer !== 'boolean' || typeof raw.qr !== 'boolean') {
    return { refused: 'invalid_receipt_settings' };
  }
  return {
    label: label || null,
    paperWidth: raw.paperWidth as ReceiptPaperWidth,
    cutter: raw.cutter,
    drawer: raw.drawer,
    qr: raw.qr,
  };
}

/** What a receipt is laid out for on this printer: the builder's profile. */
export function receiptProfileOf(
  settings: Pick<PrintReceiptSettings, 'paperWidth' | 'cutter' | 'drawer' | 'qr'>,
): ReceiptPrinterProfile {
  return { paperWidth: settings.paperWidth, cutter: settings.cutter, drawer: settings.drawer, qr: settings.qr };
}

/** The name a person sees: the place they gave it, else the queue's name. */
export function receiptPrinterName(printer: {
  name: string;
  receipt: Pick<PrintReceiptSettings, 'label'> | null;
}): string {
  return printer.receipt?.label ?? printer.name;
}

/**
 * ⚠ ONE KIND OF JOB PER KIND OF PRINTER. A receipt goes to a receipt printer
 * only; a document never does — an A4 page on a roll is metres of garbage,
 * and receipt bytes on an inkjet are a page of symbols. The refusal, or null.
 */
export function checkJobForPrinter(format: 'pdf' | 'escpos', isReceiptPrinter: boolean): PrintRefusal | null {
  if (format === 'escpos' && !isReceiptPrinter) return 'not_a_receipt_printer';
  if (format === 'pdf' && isReceiptPrinter) return 'receipt_printer_only';
  return null;
}

/**
 * The Test receipt (#144, R4): one receipt that checks, in one go, what a
 * person needs to see on a new printer — the width (a ruler of digits the
 * full line, which a wrong width wraps), bold and double size, a price flush
 * right, a QR code when it has them, the drawer when one is attached, and
 * the cut. Every line says what it tests.
 */
export function testReceiptLines(
  printer: { name: string; receipt: PrintReceiptSettings },
  printedAt: string,
): ReceiptLine[] {
  const { receipt } = printer;
  const columns = RECEIPT_COLUMNS[receipt.paperWidth];
  const ruler = Array.from({ length: columns }, (_, index) => String((index + 1) % 10)).join('');
  const lines: ReceiptLine[] = [
    { kind: 'text', text: 'TEST RECEIPT', align: 'center', bold: true, size: 'double' },
    { kind: 'text', text: receiptPrinterName(printer), align: 'center' },
    { kind: 'text', text: printedAt, align: 'center' },
    { kind: 'divider' },
    { kind: 'text', text: `${receipt.paperWidth} mm: ${columns} characters a line. This line must not wrap:` },
    { kind: 'text', text: ruler },
    { kind: 'divider' },
    { kind: 'text', text: 'Bold text', bold: true },
    { kind: 'pair', left: 'A price, flush right', right: 'PHP 123.45' },
    { kind: 'pair', left: 'TOTAL', right: 'PHP 123.45', bold: true },
    { kind: 'feed' },
  ];
  if (receipt.qr) {
    lines.push(
      { kind: 'text', text: 'A QR code (it reads "kwtech"):', align: 'center' },
      { kind: 'qr', data: 'kwtech' },
    );
  }
  if (receipt.drawer)
    lines.push({ kind: 'text', text: 'The cash drawer opens now.', align: 'center' }, { kind: 'drawer' });
  lines.push({
    kind: 'text',
    text: receipt.cutter ? 'The paper is cut below.' : 'No cutter: tear the paper here.',
    align: 'center',
  });
  lines.push({ kind: 'cut' });
  return lines;
}
