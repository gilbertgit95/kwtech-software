import { checkPosQuantity } from './money.js';

/**
 * Item search at the till (D19): as you type, in the BROWSER, over the store's
 * whole catalogue — small, and capped by `pos:items` — so there is no request
 * per keystroke and a slow connection never lags the counter.
 */

/** A variant as the search sees it. */
export interface PosSearchVariant {
  id: string;
  name: string;
  code: string | null;
  price: number;
  archived: boolean;
}

/** An item as the search sees it. */
export interface PosSearchItem {
  id: string;
  name: string;
  code: string | null;
  categoryName: string | null;
  price: number;
  archived: boolean;
  variants: readonly PosSearchVariant[];
}

/**
 * One result. `variantId` null on an item WITH variants means "open the
 * picker"; on an item without, it means "add it".
 */
export interface PosSearchResult {
  itemId: string;
  variantId: string | null;
  /** "Lamination — 250 mic · A4", or just the item's name. */
  label: string;
  code: string | null;
  /** The price, or the lowest and highest variant price when the picker opens. */
  price: { min: number; max: number };
  /** True when the item has variants and one must still be picked. */
  opensPicker: boolean;
}

/** How many results the till shows. More than a screenful means the search is not narrow enough yet. */
export const POS_SEARCH_LIMIT = 20;

/**
 * Text as the search compares it: lower case, accents removed, so "Café" and
 * "cafe" match and a cashier on a phone keyboard is not fighting diacritics.
 */
export function foldSearchText(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

function tokensOf(query: string): string[] {
  return foldSearchText(query)
    .split(/\s+/u)
    .filter((token) => token.length > 0);
}

/**
 * How well `tokens` match `fields`: 0 is best. Null when any token matches
 * nothing — every word typed must be found somewhere, in any order.
 *
 *   1 — every token starts a word ("lam a4" in "Lamination — A4")
 *   2 — some token only occurs inside a word ("mina")
 */
function rank(tokens: readonly string[], fields: readonly (string | null)[]): number | null {
  const words = fields.flatMap((field) => (field ? foldSearchText(field).split(/[\s\-_./·—()]+/u) : []));
  const text = fields.map((field) => (field ? foldSearchText(field) : '')).join(' ');
  let worst = 1;
  for (const token of tokens) {
    if (words.some((word) => word.startsWith(token))) continue;
    if (!text.includes(token)) return null;
    worst = 2;
  }
  return worst;
}

/**
 * Searches the catalogue (D19).
 *
 * - Matches name, variant name, code and category, case- and accent-blind,
 *   words in any order, partial words.
 * - ⚠ AN EXACT CODE WINS, alone at the top, so a typed code — or, later, a
 *   scanned barcode — plus Enter adds exactly that thing (D18).
 * - An item whose OWN text matches every word is one result that opens the
 *   picker ("lam" → Lamination ▾). Otherwise each matching VARIANT is a result
 *   of its own ("lam a4" → the A4 laminations), so a precise search skips the
 *   picker. Listing all seven variants for "lam" would bury the item.
 * - Archived items and variants never show; an item whose variants are all
 *   archived cannot be sold, so it does not show either.
 */
export function searchItems(
  catalogue: readonly PosSearchItem[],
  query: string,
  limit: number = POS_SEARCH_LIMIT,
): PosSearchResult[] {
  const tokens = tokensOf(query);
  if (tokens.length === 0) return [];
  const exactCode = query.trim().toUpperCase();

  const scored: { result: PosSearchResult; score: number }[] = [];
  for (const item of catalogue) {
    if (item.archived) continue;
    const variants = item.variants.filter((variant) => !variant.archived);
    const hasVariants = item.variants.length > 0;
    if (hasVariants && variants.length === 0) continue;

    if (!hasVariants) {
      if (item.code === exactCode) {
        scored.push({ result: itemResult(item, []), score: 0 });
        continue;
      }
      const score = rank(tokens, [item.name, item.code, item.categoryName]);
      if (score !== null) scored.push({ result: itemResult(item, []), score });
      continue;
    }

    const exactVariant = variants.find((variant) => variant.code === exactCode);
    if (exactVariant) {
      scored.push({ result: variantResult(item, exactVariant), score: 0 });
      continue;
    }
    const itemScore = rank(tokens, [item.name, item.code, item.categoryName]);
    if (itemScore !== null) {
      scored.push({ result: itemResult(item, variants), score: item.code === exactCode ? 0 : itemScore });
      continue;
    }
    for (const variant of variants) {
      const score = rank(tokens, [item.name, variant.name, variant.code, item.categoryName]);
      if (score !== null) scored.push({ result: variantResult(item, variant), score });
    }
  }

  scored.sort((a, b) => a.score - b.score || a.result.label.localeCompare(b.result.label));
  return scored.slice(0, limit).map((entry) => entry.result);
}

function itemResult(item: PosSearchItem, variants: readonly PosSearchVariant[]): PosSearchResult {
  if (variants.length === 0) {
    return {
      itemId: item.id,
      variantId: null,
      label: item.name,
      code: item.code,
      price: { min: item.price, max: item.price },
      opensPicker: false,
    };
  }
  const prices = variants.map((variant) => variant.price);
  return {
    itemId: item.id,
    variantId: null,
    label: item.name,
    code: item.code,
    price: { min: Math.min(...prices), max: Math.max(...prices) },
    opensPicker: true,
  };
}

function variantResult(item: PosSearchItem, variant: PosSearchVariant): PosSearchResult {
  return {
    itemId: item.id,
    variantId: variant.id,
    label: `${item.name} — ${variant.name}`,
    code: variant.code,
    price: { min: variant.price, max: variant.price },
    opensPicker: false,
  };
}

/**
 * Splits a quantity typed before the item — "100*ref" or "100*" then the item
 * (D20, the grocery habit) — from the search text. No prefix means 1.
 * An invalid quantity ("0*", "99999*") is returned as refused so the till says
 * so instead of quietly adding one.
 */
export function parseQuantityPrefix(
  query: string,
): { quantity: number; text: string } | { refused: 'invalid_quantity' } {
  const match = /^\s*(\d+)\s*\*\s*(.*)$/su.exec(query);
  if (!match) return { quantity: 1, text: query };
  const quantity = Number(match[1]);
  if (checkPosQuantity(quantity)) return { refused: 'invalid_quantity' };
  return { quantity, text: match[2] ?? '' };
}
