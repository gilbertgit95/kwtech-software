import type { PrintPaper } from '../types.js';
import { pdfLiteral, pdfNumber, pdfPoints, writePdf } from './pdf.js';

/**
 * The ruler page: one sheet that proves a printer prints at exact size, and
 * the first thing ever sent through a newly paired computer.
 *
 * Two lines of a known length meet at a corner a known distance from the
 * paper's left and top edges. Somebody measures the four with a ruler: lines
 * that are short or long mean the driver scaled the page, and a corner in the
 * wrong place means it shifted it.
 *
 * ⚠ WRITTEN BY HAND, AS A PDF, with no library: this entry point is pure, and
 * four lines and some Helvetica need nothing else. The print studio draws its
 * own ruler for calibration (`module-print-studio`); a module may not import a
 * module (PLAN §9), and this one only has to answer "does this printer scale".
 *
 * ⚠ VECTOR ONLY. A picture of a ruler would be resampled by a driver; a line
 * between two coordinates is drawn where it says.
 */

/** From the paper's LEFT edge to the corner where the lines meet. Hundredths of a millimetre. */
export const RULER_FROM_LEFT = 2000;

/** From the paper's TOP edge to that corner. */
export const RULER_FROM_TOP = 3000;

/** The lengths a ruler line may have, longest first. */
const RULER_LENGTHS = [10000, 5000, 2000] as const;

/** Clear space kept past the far end of each line, so it is not inside an unprintable strip. */
const RULER_CLEARANCE = 1000;

/**
 * How long the two lines are on this paper: 100 mm where it fits, 50 mm on a
 * photo paper, 20 mm on anything smaller.
 *
 * ⚠ THE PAGE SAYS THE LENGTH IT USED. Somebody measuring a 4R sheet must not
 * be looking for 100 mm on a paper 102 mm wide.
 */
export function rulerLineLength(paper: Pick<PrintPaper, 'width' | 'height'>): number {
  const across = paper.width - RULER_FROM_LEFT - RULER_CLEARANCE;
  const down = paper.height - RULER_FROM_TOP - RULER_CLEARANCE;
  return RULER_LENGTHS.find((length) => length <= across && length <= down) ?? 2000;
}

const mm = (hundredths: number) => String(Math.round(hundredths / 10) / 10);

/**
 * The ruler page for one paper, as the bytes of a PDF whose page is exactly
 * that paper's size.
 */
export function rulerPagePdf(paper: Pick<PrintPaper, 'name' | 'width' | 'height'>): Uint8Array {
  const width = pdfPoints(paper.width);
  const height = pdfPoints(paper.height);
  const length = rulerLineLength(paper);
  const line = pdfPoints(length);
  // PDF measures up from the bottom; the corner is measured down from the top.
  const x = pdfPoints(RULER_FROM_LEFT);
  const y = height - pdfPoints(RULER_FROM_TOP);
  const tick = pdfPoints(300);
  const text = pdfPoints(500);

  const strokes = [
    // The two lines, meeting at the corner.
    `${pdfNumber(x)} ${pdfNumber(y)} m ${pdfNumber(x + line)} ${pdfNumber(y)} l S`,
    `${pdfNumber(x)} ${pdfNumber(y)} m ${pdfNumber(x)} ${pdfNumber(y - line)} l S`,
    // A tick across each far end, so there is something exact to put the ruler against.
    `${pdfNumber(x + line)} ${pdfNumber(y - tick)} m ${pdfNumber(x + line)} ${pdfNumber(y + tick)} l S`,
    `${pdfNumber(x - tick)} ${pdfNumber(y - line)} m ${pdfNumber(x + tick)} ${pdfNumber(y - line)} l S`,
  ];
  const lines = [
    'Ruler page - printed at actual size (100%)',
    `Each line is ${mm(length)} mm long, tick to corner.`,
    `The corner is ${mm(RULER_FROM_LEFT)} mm from the left edge`,
    `and ${mm(RULER_FROM_TOP)} mm from the top edge of the paper.`,
    `Paper: ${paper.name}, ${mm(paper.width)} x ${mm(paper.height)} mm`,
  ];
  const leading = 11;
  const words = [
    'BT',
    '/F1 8 Tf',
    `${leading} TL`,
    `${pdfNumber(x + text)} ${pdfNumber(y - text - 8)} Td`,
    ...lines.map((entry, index) => `${index === 0 ? '' : 'T* '}${pdfLiteral(entry)} Tj`),
    'ET',
  ];
  const content = ['0.7 w', '0 G', ...strokes, ...words].join('\n');

  return writePdf([{ width, height, content }], 'Helvetica');
}
