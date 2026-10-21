import type { StockQuantity, StockRefusal, StockUnit } from '../types.js';

/**
 * Quantities and what they are worth, the one place that turns a typed "1.5"
 * into thousandths and back (INVENTORY-PLAN §3). The form shows what this
 * prints and the server stores what this parses, so the two cannot round
 * differently (principle 5).
 */

/** Thousandths per whole unit: `1000` is one sheet, one metre, one millilitre. */
export const STOCK_QUANTITY_SCALE = 1000;

/**
 * The largest quantity one movement may carry: a million units. Held well
 * under a Postgres `INTEGER` (2,147,483,647 thousandths) so that the SUM of
 * a few thousand movements still fits once the server adds them up as a
 * `BIGINT`, and so a typo of six extra zeros is refused rather than recorded.
 */
export const STOCK_QUANTITY_MAX = 1_000_000 * STOCK_QUANTITY_SCALE;

/** The largest unit cost, in centavos per whole unit: ₱1,000,000, as `POS_PRICE_MAX`. */
export const STOCK_COST_MAX = 100_000_000;

/**
 * Units counted whole in the UI (I6). Half a sheet is not a thing a shop
 * counts, and a "0.3 piece" typed by mistake would make every later count
 * look wrong. Stored in thousandths all the same, so a unit can change rule
 * later without a data migration.
 */
const WHOLE_UNITS: ReadonlySet<StockUnit> = new Set<StockUnit>(['piece', 'sheet', 'pack']);

/** Every unit, in the order a form lists them. */
export const STOCK_UNITS: readonly StockUnit[] = ['piece', 'sheet', 'pack', 'ml', 'l', 'g', 'kg', 'm'];

/** True when the unit takes no decimals in the UI. */
export function isWholeStockUnit(unit: StockUnit): boolean {
  return WHOLE_UNITS.has(unit);
}

/**
 * The unit's name next to a quantity, singular for exactly one: "1 sheet",
 * "2 sheets", "1.5 m". Symbols (ml, g, m) never take an s.
 */
export function stockUnitLabel(unit: StockUnit, quantity: StockQuantity): string {
  const one = Math.abs(quantity) === STOCK_QUANTITY_SCALE;
  switch (unit) {
    case 'piece':
      return one ? 'piece' : 'pieces';
    case 'sheet':
      return one ? 'sheet' : 'sheets';
    case 'pack':
      return one ? 'pack' : 'packs';
    case 'ml':
    case 'l':
    case 'g':
    case 'kg':
    case 'm':
      return unit;
  }
}

/** True for an integer number of thousandths within the movement cap, either sign. */
export function isStockQuantity(value: number): boolean {
  return Number.isSafeInteger(value) && Math.abs(value) <= STOCK_QUANTITY_MAX;
}

/**
 * Why `quantity` cannot be moved for an item counted in `unit`, or null. Zero
 * is refused: a movement that changes nothing explains nothing.
 */
export function checkStockQuantity(quantity: StockQuantity, unit: StockUnit): StockRefusal | null {
  if (!isStockQuantity(quantity) || quantity === 0) return 'invalid_quantity';
  if (isWholeStockUnit(unit) && quantity % STOCK_QUANTITY_SCALE !== 0) return 'whole_units_only';
  return null;
}

/**
 * A typed quantity ("12", "1.5", "0.25", "-3") as thousandths, or why not.
 *
 * ⚠ PARSED AS TEXT, NEVER THROUGH `Number(...) * 1000`: `1.005 * 1000` is
 * `1004.9999999999999` in a float, and a form that sent 1004 would record a
 * thousandth less than it showed. More than three decimals is refused rather
 * than rounded, for the same reason.
 *
 * `allowNegative` is for an adjustment typed as one signed number; everywhere
 * else the direction is a choice on the form and the quantity is positive.
 */
export function parseStockQuantity(
  raw: string,
  unit: StockUnit,
  options: { allowNegative?: boolean } = {},
): { quantity: StockQuantity } | { refused: StockRefusal } {
  const text = raw.trim().replace(/,/gu, '');
  const match = /^(-?)(\d+)(?:\.(\d{1,3}))?$/u.exec(text);
  if (!match) return { refused: 'invalid_quantity' };
  const [, sign = '', whole = '0', fraction = ''] = match;
  if (sign === '-' && !options.allowNegative) return { refused: 'invalid_quantity' };
  // Bounded before multiplying, so a 30-digit paste never reaches a float.
  if (whole.length > 7) return { refused: 'invalid_quantity' };
  const magnitude = Number(whole) * STOCK_QUANTITY_SCALE + Number(fraction.padEnd(3, '0'));
  const quantity = sign === '-' ? -magnitude : magnitude;
  const refused = checkStockQuantity(quantity, unit);
  if (refused) return { refused };
  return { quantity };
}

/**
 * Thousandths as the shop reads them: "12", "1.5", "0.25", "-3". No grouping,
 * so what is printed can be typed back into `parseStockQuantity`.
 */
export function formatStockQuantity(quantity: StockQuantity): string {
  const sign = quantity < 0 ? '-' : '';
  const magnitude = Math.abs(quantity);
  const whole = Math.trunc(magnitude / STOCK_QUANTITY_SCALE);
  const fraction = magnitude % STOCK_QUANTITY_SCALE;
  if (fraction === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${String(fraction).padStart(3, '0').replace(/0+$/u, '')}`;
}

/** Why `cost` (centavos per whole unit, or null for "not entered") is refused, or null. */
export function checkStockCost(cost: number | null): StockRefusal | null {
  if (cost === null) return null;
  if (!Number.isSafeInteger(cost) || cost < 0 || cost > STOCK_COST_MAX) return 'invalid_cost';
  return null;
}

/**
 * What `quantity` thousandths are worth at `unitCost` centavos per whole unit,
 * rounded half up to the centavo. Null when the cost was never entered; zero
 * when nothing is on hand, because a negative count is a wrong count, not a
 * debt the shelf owes.
 *
 * ⚠ MULTIPLIED AS A BIGINT. A million units at ₱1,000,000 is 10¹⁷ centavos ×
 * thousandths, past the 2⁵³ a float holds exactly.
 */
export function stockValueAtCost(quantity: StockQuantity, unitCost: number | null): number | null {
  if (unitCost === null) return null;
  if (quantity <= 0) return 0;
  const scaled = BigInt(quantity) * BigInt(unitCost);
  const scale = BigInt(STOCK_QUANTITY_SCALE);
  return Number((scaled + scale / 2n) / scale);
}
