import type { PosCatalogueView } from '../pos-client.js';
import { formatPeso } from './money.js';
import { escapeHtml } from './receipt.js';
import type { CsvCell } from './reports.js';
import { gridItems, liveVariants } from './till.js';

/**
 * The price list (Items → Print / CSV): every item the till can sell, with
 * its price, for a paper copy at the counter. Pure, so what prints is tested;
 * the Items section hands the HTML to the receipt's hidden frame, and the CSV
 * to the same download as the reports.
 *
 * - **What the till sells, nothing else.** The items come from `gridItems`,
 *   so an archived item, or one whose every variant is archived, is left off
 *   here exactly as it is left off the till — a printed price for something
 *   that cannot be rung up is a dispute at the counter.
 * - **Never costs.** The list is for customers to read; `pos:manage_items`
 *   sees costs on screen, but they do not leave on paper.
 * - **Ignores the search box.** "The whole list" is the point; a filtered
 *   print would pass for the full one.
 */

export interface PriceListLine {
  name: string;
  code: string | null;
  /** In centavos. */
  price: number;
}

export interface PriceListItem extends PriceListLine {
  description: string | null;
  /** The live variants, each with its own price. Empty when the item is sold as it is. */
  variants: PriceListLine[];
}

export interface PriceListSection {
  /** The category's name, or "Other" for items with no category (or an archived one). */
  title: string;
  items: PriceListItem[];
}

/** The heading for items with no live category. Last, so the store's own categories lead. */
export const PRICE_LIST_OTHER = 'Other';

/** The list by category, in the store's category order (as the till's tabs), items by name within each. */
export function priceListSections(catalogue: PosCatalogueView): PriceListSection[] {
  const categories = catalogue.categories
    .filter((category) => category.archivedAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const live = new Set(categories.map((category) => category.id));
  const byCategory = new Map<string | null, PriceListItem[]>();
  for (const item of gridItems(catalogue, null)) {
    const key = item.categoryId !== null && live.has(item.categoryId) ? item.categoryId : null;
    const entry: PriceListItem = {
      name: item.name,
      code: item.code,
      description: item.description,
      price: item.price,
      variants: liveVariants(item)
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((variant) => ({ name: variant.name, code: variant.code, price: variant.price })),
    };
    byCategory.set(key, [...(byCategory.get(key) ?? []), entry]);
  }
  const sections: PriceListSection[] = categories
    .map((category) => ({ title: category.name, items: byCategory.get(category.id) ?? [] }))
    .filter((section) => section.items.length > 0);
  const other = byCategory.get(null);
  if (other) sections.push({ title: PRICE_LIST_OTHER, items: other });
  return sections;
}

/**
 * The price list as printable HTML, A4 or letter. ⚠ ESCAPED: every name,
 * code and description is text somebody typed. The date says which prices
 * these were, so an old copy on the wall shows its age.
 */
export function priceListHtml(catalogue: PosCatalogueView, printedAt: Date, timeZone: string): string {
  const sections = priceListSections(catalogue);
  const row = (line: PriceListLine, cls: string, note: string | null = null) =>
    `<tr class="${cls}"><td>${escapeHtml(line.name)}${note ? `<div class="d">${escapeHtml(note)}</div>` : ''}</td><td class="c">${escapeHtml(line.code ?? '')}</td><td class="r">${escapeHtml(formatPeso(line.price))}</td></tr>`;
  const body =
    sections.length === 0
      ? '<p>No items to list.</p>'
      : sections
          .map((section) => {
            const rows = section.items
              .map((item) =>
                item.variants.length === 0
                  ? row(item, 'it', item.description)
                  : `<tr class="it"><td colspan="3">${escapeHtml(item.name)}${item.description ? `<div class="d">${escapeHtml(item.description)}</div>` : ''}</td></tr>${item.variants.map((variant) => row(variant, 'v')).join('')}`,
              )
              .join('');
            return `<h2>${escapeHtml(section.title)}</h2><table><thead><tr><th>Item</th><th class="c">Code</th><th class="r">Price</th></tr></thead><tbody>${rows}</tbody></table>`;
          })
          .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Price list</title><style>
@page{margin:14mm}body{font:12px/1.4 system-ui,sans-serif;margin:0;color:#000}h1{font-size:18px;margin:0}
p{margin:2px 0 12px}h2{font-size:14px;margin:16px 0 4px;break-after:avoid}
table{width:100%;border-collapse:collapse}th{text-align:left;font-size:11px;border-bottom:1px solid #000;padding:3px 4px}
td{padding:3px 4px;border-bottom:1px solid #ddd;vertical-align:top}tr{break-inside:avoid}
.r{text-align:right;white-space:nowrap;width:1%}.c{white-space:nowrap;width:1%;color:#444}
.it td{font-weight:600}.v td:first-child{padding-left:20px}.d{font-weight:400;font-size:11px;color:#444}
</style></head><body><h1>Price list</h1><p>${escapeHtml(priceListSubtitle(printedAt, timeZone))}</p>${body}</body></html>`;
}

/**
 * The price list as CSV rows, header first: one row per thing the till rings
 * up — an item sold as it is, or each live variant of one. Prices in pesos,
 * as spreadsheet numbers, the same way the report CSVs write them.
 */
export function priceListCsvRows(catalogue: PosCatalogueView): CsvCell[][] {
  const rows: CsvCell[][] = [['Category', 'Item', 'Variant', 'Code', 'Price (PHP)']];
  for (const section of priceListSections(catalogue)) {
    for (const item of section.items) {
      if (item.variants.length === 0) {
        rows.push([section.title, item.name, null, item.code, item.price / 100]);
        continue;
      }
      for (const variant of item.variants) {
        rows.push([section.title, item.name, variant.name, variant.code ?? item.code, variant.price / 100]);
      }
    }
  }
  return rows;
}

/** The file the CSV downloads as, by the store's day: `pos-price-list-2026-10-17.csv`. */
export function priceListFileName(day: string): string {
  return `pos-price-list-${day}.csv`;
}

// ── the PDF's pages, for a printer on a paired computer ─────────────────────

/**
 * The papers the PDF can be made on. Lengths in hundredths of a millimetre, as
 * the printer port takes them. ⚠ The printer must report a paper of that size,
 * or `module-print` refuses the job with a sentence; so the person picks the
 * one in its tray, A4 or Letter ("short bond").
 */
export const PRICE_LIST_PAPERS = [
  { key: 'a4', label: 'A4 (210 × 297 mm)', width: 21_000, height: 29_700 },
  { key: 'letter', label: 'Letter (8.5 × 11 in)', width: 21_590, height: 27_940 },
] as const;

export type PriceListPaper = (typeof PRICE_LIST_PAPERS)[number];

/** Hundredths of a millimetre as PDF points (1/72 in). */
export function paperPoints(units: number): number {
  return (units * 72) / 2540;
}

/** The page's margin, and the room kept at the foot for "Page 1 of 2", in points. */
export const PRICE_LIST_MARGIN = 40;
export const PRICE_LIST_FOOTER = 24;

export type PriceListRow =
  | { kind: 'heading'; title: string; subtitle: string }
  | { kind: 'section'; title: string }
  | { kind: 'item'; name: string; note: string | null; code: string | null; price: string | null }
  | { kind: 'variant'; name: string; code: string | null; price: string };

export interface PriceListPage {
  /** Each row and its top, in points from the top of the page. */
  rows: { row: PriceListRow; top: number }[];
  footer: string;
}

/** How tall a row is drawn, in points. An item with a description takes a second line. */
export function priceListRowHeight(row: PriceListRow): number {
  switch (row.kind) {
    case 'heading':
      return 44;
    case 'section':
      return 28;
    case 'item':
      return row.note ? 30 : 18;
    case 'variant':
      return 16;
  }
}

/**
 * The list laid out on pages of `pageHeight` points: the same sections the
 * paper print shows, so both say the same.
 *
 * - **A heading never ends a page.** A section starts on a page with room for
 *   its first item, and an item with variants for its first variant.
 * - **A page that carries on says so:** "Printing (continued)" at its top,
 *   and the item's name again when its variants run over.
 */
export function priceListPages(
  sections: readonly PriceListSection[],
  subtitle: string,
  pageHeight: number,
): PriceListPage[] {
  const bottom = pageHeight - PRICE_LIST_MARGIN - PRICE_LIST_FOOTER;
  const pages: PriceListPage['rows'][] = [];
  let rows: PriceListPage['rows'] = [];
  let top = PRICE_LIST_MARGIN;
  const place = (row: PriceListRow) => {
    rows.push({ row, top });
    top += priceListRowHeight(row);
  };
  const fits = (height: number) => top + height <= bottom;
  const newPage = () => {
    pages.push(rows);
    rows = [];
    top = PRICE_LIST_MARGIN;
  };

  place({ kind: 'heading', title: 'Price list', subtitle });
  if (sections.length === 0) place({ kind: 'section', title: 'No items to list.' });
  for (const section of sections) {
    const continued: PriceListRow = { kind: 'section', title: `${section.title} (continued)` };
    for (const [index, item] of section.items.entries()) {
      const itemRow: PriceListRow = {
        kind: 'item',
        name: item.name,
        note: item.description,
        code: item.code,
        price: item.variants.length === 0 ? formatPeso(item.price) : null,
      };
      const first = item.variants[0];
      const needed = priceListRowHeight(itemRow) + (first ? priceListRowHeight(variantRow(first)) : 0);
      if (index === 0) {
        const heading: PriceListRow = { kind: 'section', title: section.title };
        if (!fits(priceListRowHeight(heading) + needed)) newPage();
        place(heading);
      } else if (!fits(needed)) {
        newPage();
        place(continued);
      }
      place(itemRow);
      for (const variant of item.variants) {
        const row = variantRow(variant);
        if (!fits(priceListRowHeight(row))) {
          newPage();
          place(continued);
          place({ kind: 'item', name: `${item.name} (continued)`, note: null, code: null, price: null });
        }
        place(row);
      }
    }
  }
  pages.push(rows);
  return pages.map((page, index) => ({ rows: page, footer: `Page ${index + 1} of ${pages.length}` }));
}

function variantRow(variant: PriceListLine): PriceListRow {
  return { kind: 'variant', name: variant.name, code: variant.code, price: formatPeso(variant.price) };
}

/** The line under the heading, in the store's zone: "Prices as of Oct 17, 2026, 1:00 AM". */
export function priceListSubtitle(printedAt: Date, timeZone: string): string {
  return `Prices as of ${printedAt.toLocaleString('en-PH', { timeZone, dateStyle: 'medium', timeStyle: 'short' })}`;
}
