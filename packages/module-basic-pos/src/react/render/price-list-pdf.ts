'use client';

import type { PosCatalogueView } from '../pos-client.js';
import {
  PRICE_LIST_MARGIN,
  type PriceListPage,
  type PriceListPaper,
  type PriceListRow,
  paperPoints,
  priceListPages,
  priceListRowHeight,
  priceListSections,
  priceListSubtitle,
} from '../view/price-list.js';

/** How sharply each page is drawn. 300 dpi prints as crisp as text on an office printer. */
const DOTS_PER_INCH = 300;
const SCALE = DOTS_PER_INCH / 72;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/** The price column's width, in points, and the code column's left of it. */
const PRICE_WIDTH = 80;
const CODE_WIDTH = 60;

/**
 * The price list as a PDF, for one of the workspace's printers (the printer
 * port). The pages come from `priceListPages`, so they hold what the browser
 * print holds.
 *
 * ⚠ THE PAGES ARE PICTURES, not text, as the print studio's written documents
 * (`makeCustomDocumentPdf`). pdf-lib's built-in fonts cannot write "₱", nor
 * whatever a person typed into an item's name; the browser's canvas can. The
 * cost is a larger file, which goes to the printer and is kept nowhere.
 *
 * pdf-lib is imported when a person prints, so the till never loads it.
 */
export async function makePriceListPdf(
  catalogue: PosCatalogueView,
  paper: PriceListPaper,
  printedAt: Date,
  timeZone: string,
): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const width = paperPoints(paper.width);
  const height = paperPoints(paper.height);
  const pages = priceListPages(priceListSections(catalogue), priceListSubtitle(printedAt, timeZone), height);
  const out = await PDFDocument.create();
  out.setTitle('Price list');
  // In order, one at a time: each page is a large picture, and the order is the list's.
  for (const page of pages) {
    const image = await out.embedPng(drawPage(page, width, height));
    out.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
  }
  return out.save();
}

/** One page, drawn in points on a canvas scaled to `DOTS_PER_INCH`, as a PNG `data:` URL. */
function drawPage(page: PriceListPage, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * SCALE);
  canvas.height = Math.round(height * SCALE);
  // Opaque: a PNG with no alpha channel is embedded without a soft mask, at about half the size.
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('This browser cannot draw the price list. Use Print price list instead.');
  context.scale(SCALE, SCALE);
  // ⚠ White first: a PNG is transparent where nothing is drawn, and some printers print that black.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);

  const left = PRICE_LIST_MARGIN;
  const right = width - PRICE_LIST_MARGIN;
  for (const { row, top } of page.rows) drawRow(context, row, top, left, right);

  text(context, page.footer, width / 2, height - PRICE_LIST_MARGIN, { size: 9, color: '#555', align: 'center' });
  return canvas.toDataURL('image/png');
}

function drawRow(context: CanvasRenderingContext2D, row: PriceListRow, top: number, left: number, right: number) {
  const priceRight = right - 4;
  const codeRight = right - PRICE_WIDTH;
  const nameWidth = codeRight - CODE_WIDTH - left;
  const height = priceListRowHeight(row);
  switch (row.kind) {
    case 'heading':
      text(context, row.title, left, top + 18, { size: 18, weight: 700, max: right - left });
      text(context, row.subtitle, left, top + 34, { size: 10, color: '#333', max: right - left });
      return;
    case 'section':
      text(context, row.title, left, top + 19, { size: 13, weight: 700, max: right - left });
      rule(context, left, right, top + height - 3, '#000');
      return;
    case 'item':
      text(context, row.name, left + 4, top + 13, { size: 11, weight: 600, max: nameWidth });
      if (row.note) text(context, row.note, left + 4, top + 25, { size: 9, color: '#444', max: nameWidth });
      if (row.code)
        text(context, row.code, codeRight, top + 13, { size: 9.5, color: '#444', align: 'right', max: CODE_WIDTH });
      if (row.price) text(context, row.price, priceRight, top + 13, { size: 11, weight: 700, align: 'right' });
      rule(context, left, right, top + height, '#ccc');
      return;
    case 'variant':
      text(context, row.name, left + 18, top + 12, { size: 10.5, max: nameWidth - 14 });
      if (row.code)
        text(context, row.code, codeRight, top + 12, { size: 9.5, color: '#444', align: 'right', max: CODE_WIDTH });
      text(context, row.price, priceRight, top + 12, { size: 10.5, align: 'right' });
      rule(context, left, right, top + height, '#ddd');
      return;
  }
}

interface TextStyle {
  size: number;
  weight?: number;
  color?: string;
  align?: CanvasTextAlign;
  /** The widest it may be drawn, in points; longer text ends in "…". */
  max?: number;
}

function text(context: CanvasRenderingContext2D, value: string, x: number, baseline: number, style: TextStyle) {
  context.font = `${style.weight ?? 400} ${style.size}px ${FONT}`;
  context.fillStyle = style.color ?? '#000';
  context.textAlign = style.align ?? 'left';
  context.textBaseline = 'alphabetic';
  context.fillText(style.max === undefined ? value : fitted(context, value, style.max), x, baseline);
}

/** The text cut to fit, with "…", rather than running into the next column. */
function fitted(context: CanvasRenderingContext2D, value: string, max: number): string {
  if (context.measureText(value).width <= max) return value;
  let kept = value;
  while (kept.length > 0 && context.measureText(`${kept}…`).width > max) kept = kept.slice(0, -1);
  return `${kept.trimEnd()}…`;
}

function rule(context: CanvasRenderingContext2D, left: number, right: number, y: number, color: string) {
  context.strokeStyle = color;
  context.lineWidth = 0.75;
  context.beginPath();
  context.moveTo(left, y);
  context.lineTo(right, y);
  context.stroke();
}
