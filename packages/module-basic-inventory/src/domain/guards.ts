import type { StockAdjustReason, StockItemKind, StockUnit, StockWasteReason } from '../types.js';
import { STOCK_ADJUST_REASONS, STOCK_WASTE_REASONS } from './moves.js';
import { STOCK_UNITS } from './quantities.js';

/**
 * Narrowing a wire string to one of this module's unions. Kinds, units and
 * reasons cross GraphQL as documented strings (no enums), so the server checks
 * each one here before it reaches a column or a rule.
 */

export function isStockItemKind(value: string): value is StockItemKind {
  return value === 'for_sale' || value === 'material';
}

export function isStockUnit(value: string): value is StockUnit {
  return (STOCK_UNITS as readonly string[]).includes(value);
}

export function isStockAdjustReason(value: string): value is StockAdjustReason {
  return (STOCK_ADJUST_REASONS as readonly string[]).includes(value);
}

export function isStockWasteReason(value: string): value is StockWasteReason {
  return (STOCK_WASTE_REASONS as readonly string[]).includes(value);
}
