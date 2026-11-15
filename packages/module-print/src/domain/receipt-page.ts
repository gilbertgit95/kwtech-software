import type { PrintPaper } from '../types.js';
import { pdfLiteral, pdfNumber, pdfPoints, writePdf } from './pdf.js';
import { type ReceiptLine, receiptPlainText } from './receipt.js';

/**
 * A receipt on an ordinary printer (#144, R5): the fallback when no receipt
 * printer can print it. The same text the roll would carry (R1's plain-text
 * layout, 48 columns, as on 80 mm paper), as a narrow column at the top left
 * of the printer's own paper, in Courier so the columns line up.
 *
 * ⚠ ON THE PAPER THE PRINTER HAS, not on a page 80 mm wide: an office printer
 * reports A4 or Letter and refuses a size it does not hold. A long receipt
 * runs onto a second sheet rather than shrinking.
 *
 * ⚠ NO CUT, NO DRAWER, A QR CODE AS ITS TEXT. A page printer has none of
 * them; the drawer is opened by hand.
 */

/** Courier at this size is 4.8 points a character: 48 columns are 81 mm, a receipt's width. */
export const RECEIPT_PAGE_FONT_SIZE = 8;

/** From one line of text to the next. Points. */
const LEADING = 10;

/** Clear space from the paper's edges. Hundredths of a millimetre: 12 mm, inside any printer's unprintable strip. */
const MARGIN = 1200;

/** The plain-text layout the page carries: as an 80 mm roll with no cutter, no drawer and no QR. */
const PAGE_PROFILE = { paperWidth: 80, cutter: false, drawer: false, qr: false } as const;

/** The receipt as a PDF on `paper`, one sheet or more. */
export function receiptPagePdf(lines: readonly ReceiptLine[], paper: Pick<PrintPaper, 'width' | 'height'>): Uint8Array {
  const width = pdfPoints(paper.width);
  const height = pdfPoints(paper.height);
  const margin = pdfPoints(MARGIN);
  const rows = receiptPlainText(lines, PAGE_PROFILE).split('\n');
  const perPage = Math.max(1, Math.floor((height - 2 * margin) / LEADING));

  const pages = [];
  for (let start = 0; start < rows.length; start += perPage) {
    const content = [
      'BT',
      `/F1 ${RECEIPT_PAGE_FONT_SIZE} Tf`,
      `${LEADING} TL`,
      `${pdfNumber(margin)} ${pdfNumber(height - margin - RECEIPT_PAGE_FONT_SIZE)} Td`,
      ...rows.slice(start, start + perPage).map((row, index) => `${index === 0 ? '' : 'T* '}${pdfLiteral(row)} Tj`),
      'ET',
    ].join('\n');
    pages.push({ width, height, content });
  }
  return writePdf(pages, 'Courier');
}
