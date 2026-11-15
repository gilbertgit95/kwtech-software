/**
 * The smallest PDF writer that prints: pages of drawing commands in one
 * base-14 font, written by hand with no library, so this entry point stays
 * pure. The ruler page and a receipt's narrow page (#144, R5) are its two
 * pages; anything with pictures or a typed name in any script belongs to a
 * module with a real PDF library (the print studio, the POS's price list).
 *
 * ⚠ ASCII ONLY. A base font with no encoding prints nothing else right, so
 * `pdfLiteral` drops what is not printable ASCII, and the byte offsets in the
 * cross-reference table are exact only because every character is one byte.
 */

/** Hundredths of a millimetre, the module's unit, as PDF points (1/72 inch). */
export function pdfPoints(length: number): number {
  return (length * 72) / 2540;
}

/** A number as PDF writes it: at most three decimals, never an exponent. */
export function pdfNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** Text as a PDF literal string. ⚠ ASCII ONLY: anything else is dropped. */
export function pdfLiteral(text: string): string {
  const ascii = [...text].filter((character) => character >= ' ' && character <= '~').join('');
  return `(${ascii.replace(/[\\()]/g, (character) => `\\${character}`)})`;
}

/** One page: its size in points, and its content stream, which names the font `/F1`. */
export interface PdfPage {
  width: number;
  height: number;
  content: string;
}

/** The pages as the bytes of one PDF, all in `font` (a base-14 name: Helvetica, Courier). */
export function writePdf(pages: readonly PdfPage[], font: 'Helvetica' | 'Courier'): Uint8Array {
  // 1 catalog, 2 pages, 3 the font, then a page and its content per page.
  const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /${font} >>`,
  ];
  pages.forEach((page, index) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(page.width)} ${pdfNumber(page.height)}] /Contents ${5 + index * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
      `<< /Length ${page.content.length} >>\nstream\n${page.content}\nendstream`,
    );
  });

  let file = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(file.length);
    file += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) file += `${String(offset).padStart(10, '0')} 00000 n \n`;
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(file.length);
  for (let index = 0; index < file.length; index += 1) bytes[index] = file.charCodeAt(index) & 0xff;
  return bytes;
}
