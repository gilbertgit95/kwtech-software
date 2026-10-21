import { isStockAdjustReason, isStockItemKind, isStockUnit, isStockWasteReason } from '../../domain/guards.js';
import { formatStockQuantity, parseStockQuantity } from '../../domain/quantities.js';
import { checkUseList } from '../../domain/uses.js';
import type { StockRefusal, StockUnit } from '../../types.js';
import type { StockItemView } from '../../views.js';
import type { StockAdjustInput, StockItemInput, StockReceiveInput, StockWasteInput } from '../stock-client.js';
import { parsePeso } from './money.js';

/**
 * The forms' drafts — what is typed — checked by the SAME domain rules the
 * server runs (`parseStockQuantity`, `checkUseList`), so a form says why before
 * Save and the server refuses for the same reason. Each validator returns the
 * input to send, or the errors per field.
 */

export type FormResult<T, K extends string> =
  | { ok: true; input: T }
  | { ok: false; errors: Partial<Record<K, string>> };

/** The units counted whole, as a sentence starts with them. */
const WHOLE_UNIT_WORD: Readonly<Partial<Record<StockUnit, string>>> = {
  piece: 'Pieces',
  sheet: 'Sheets',
  pack: 'Packs',
};

/** A domain refusal about a typed quantity, as the form says it. */
export function quantityProblem(refused: StockRefusal, unit: StockUnit): string {
  if (refused === 'whole_units_only') return `${WHOLE_UNIT_WORD[unit] ?? 'This unit'} are counted whole.`;
  return 'Type a number above zero, with at most three decimals, such as 12 or 1.5.';
}

// ── stock item ────────────────────────────────────────────────────────────

export interface ItemDraft {
  kind: string;
  name: string;
  code: string;
  unit: string;
  unitCost: string;
  lowStockAt: string;
  categoryId: string;
}

export function itemDraft(item: StockItemView | null): ItemDraft {
  return {
    kind: item?.kind ?? 'material',
    name: item?.name ?? '',
    code: item?.code ?? '',
    unit: item?.unit ?? 'piece',
    unitCost: item?.unitCost === null || item?.unitCost === undefined ? '' : (item.unitCost / 100).toFixed(2),
    lowStockAt: item?.lowStockAt ? formatStockQuantity(item.lowStockAt) : '',
    categoryId: item?.categoryId ?? '',
  };
}

export function validateItemDraft(
  draft: ItemDraft,
  id: string | null,
): FormResult<StockItemInput, 'name' | 'unitCost' | 'lowStockAt' | 'kind'> {
  const errors: Partial<Record<'name' | 'unitCost' | 'lowStockAt' | 'kind', string>> = {};
  if (draft.name.trim() === '') errors.name = 'Give it a name.';
  if (!isStockItemKind(draft.kind) || !isStockUnit(draft.unit)) errors.kind = 'Choose what it is for and its unit.';
  const unitCost = draft.unitCost.trim() === '' ? null : parsePeso(draft.unitCost);
  if (draft.unitCost.trim() !== '' && unitCost === null)
    errors.unitCost = 'Type a cost such as 4.20, or leave it empty.';
  let lowStockAt: number | null = null;
  if (draft.lowStockAt.trim() !== '' && isStockUnit(draft.unit)) {
    const parsed = parseStockQuantity(draft.lowStockAt, draft.unit);
    if ('refused' in parsed) errors.lowStockAt = quantityProblem(parsed.refused, draft.unit);
    else lowStockAt = parsed.quantity;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      id,
      kind: draft.kind,
      name: draft.name,
      code: draft.code.trim() === '' ? null : draft.code,
      unit: draft.unit,
      unitCost,
      lowStockAt,
      categoryId: draft.categoryId === '' ? null : draft.categoryId,
    },
  };
}

// ── receive ───────────────────────────────────────────────────────────────

export interface ReceiveDraft {
  stockItemId: string;
  quantity: string;
  unitCost: string;
  supplier: string;
  reference: string;
  opening: boolean;
}

export function validateReceiveDraft(
  draft: ReceiveDraft,
  item: Pick<StockItemView, 'unit'> | null,
  clientId: string,
): FormResult<StockReceiveInput, 'stockItemId' | 'quantity' | 'unitCost'> {
  const errors: Partial<Record<'stockItemId' | 'quantity' | 'unitCost', string>> = {};
  if (!item) errors.stockItemId = 'Choose what arrived.';
  const parsed = item ? parseStockQuantity(draft.quantity, item.unit) : null;
  if (item && parsed && 'refused' in parsed) errors.quantity = quantityProblem(parsed.refused, item.unit);
  const unitCost = draft.unitCost.trim() === '' ? null : parsePeso(draft.unitCost);
  if (draft.unitCost.trim() !== '' && unitCost === null)
    errors.unitCost = 'Type a cost such as 4.20, or leave it empty.';
  if (Object.keys(errors).length > 0 || !parsed || 'refused' in parsed) return { ok: false, errors };
  return {
    ok: true,
    input: {
      stockItemId: draft.stockItemId,
      quantity: parsed.quantity,
      unitCost,
      supplier: draft.supplier.trim() || null,
      reference: draft.reference.trim() || null,
      opening: draft.opening,
      clientId,
    },
  };
}

// ── adjust ────────────────────────────────────────────────────────────────

export interface AdjustDraft {
  stockItemId: string;
  direction: 'in' | 'out';
  quantity: string;
  reason: string;
  note: string;
}

export function validateAdjustDraft(
  draft: AdjustDraft,
  item: Pick<StockItemView, 'unit'> | null,
  clientId: string,
): FormResult<StockAdjustInput, 'stockItemId' | 'quantity' | 'reason' | 'note'> {
  const errors: Partial<Record<'stockItemId' | 'quantity' | 'reason' | 'note', string>> = {};
  if (!item) errors.stockItemId = 'Choose which item.';
  const parsed = item ? parseStockQuantity(draft.quantity, item.unit) : null;
  if (item && parsed && 'refused' in parsed) errors.quantity = quantityProblem(parsed.refused, item.unit);
  if (!isStockAdjustReason(draft.reason)) errors.reason = 'Choose a reason.';
  if (draft.reason === 'other' && draft.note.trim() === '') errors.note = 'Say what happened.';
  if (Object.keys(errors).length > 0 || !parsed || 'refused' in parsed) return { ok: false, errors };
  return {
    ok: true,
    input: {
      stockItemId: draft.stockItemId,
      quantity: draft.direction === 'out' ? -parsed.quantity : parsed.quantity,
      reason: draft.reason,
      note: draft.note.trim() || null,
      clientId,
    },
  };
}

// ── waste ─────────────────────────────────────────────────────────────────

export interface WasteLineDraft {
  /** The row's own key on screen: a draft line has no id until it is saved. */
  key: string;
  stockItemId: string;
  quantity: string;
}

export interface WasteDraft {
  lines: WasteLineDraft[];
  reason: string;
  note: string;
}

/**
 * Lines left empty or at zero are dropped — "the hook was not used yet" is a
 * line cleared, not an error — and at least one must remain.
 */
export function validateWasteDraft(
  draft: WasteDraft,
  unitOf: (stockItemId: string) => StockUnit | null,
  of: { refId: string; refLabel: string } | null,
  clientId: string,
): FormResult<StockWasteInput, 'lines' | 'reason' | 'note'> {
  const errors: Partial<Record<'lines' | 'reason' | 'note', string>> = {};
  const lines: { stockItemId: string; quantity: number }[] = [];
  for (const line of draft.lines) {
    const unit = unitOf(line.stockItemId);
    if (!unit || line.quantity.trim() === '' || /^0*(\.0*)?$/u.test(line.quantity.trim())) continue;
    const parsed = parseStockQuantity(line.quantity, unit);
    if ('refused' in parsed) {
      errors.lines = quantityProblem(parsed.refused, unit);
      continue;
    }
    lines.push({ stockItemId: line.stockItemId, quantity: parsed.quantity });
  }
  if (lines.length === 0 && !errors.lines) errors.lines = 'Say how much of at least one item was wasted.';
  if (!isStockWasteReason(draft.reason)) errors.reason = 'Choose a reason.';
  if (draft.reason === 'other' && draft.note.trim() === '') errors.note = 'Say what happened.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      lines,
      reason: draft.reason,
      note: draft.note.trim() || null,
      ofRefId: of?.refId ?? null,
      ofRefLabel: of?.refLabel ?? null,
      clientId,
    },
  };
}

// ── materials list ────────────────────────────────────────────────────────

export interface UseLineDraft {
  stockItemId: string;
  quantity: string;
}

/** A list as typed → what `setStockUses` sends, or the one problem to show. Empty lines are dropped. */
export function validateUseList(
  lines: readonly UseLineDraft[],
  unitOf: (stockItemId: string) => StockUnit | null,
): { ok: true; lines: { stockItemId: string; quantityPerUnit: number }[] } | { ok: false; error: string } {
  const out: { stockItemId: string; quantityPerUnit: number }[] = [];
  for (const line of lines) {
    if (line.stockItemId === '' && line.quantity.trim() === '') continue;
    const unit = unitOf(line.stockItemId);
    if (!unit) return { ok: false, error: 'Choose a stock item for every line, or remove the line.' };
    const parsed = parseStockQuantity(line.quantity, unit);
    if ('refused' in parsed) return { ok: false, error: quantityProblem(parsed.refused, unit) };
    out.push({ stockItemId: line.stockItemId, quantityPerUnit: parsed.quantity });
  }
  const refused = checkUseList(
    out.map((line) => ({ stockItemId: line.stockItemId, quantityPerUnit: line.quantityPerUnit })),
  );
  if (refused === 'duplicate_use')
    return { ok: false, error: 'Each stock item appears once — change its quantity instead.' };
  if (refused) return { ok: false, error: 'A quantity per sale is above zero.' };
  return { ok: true, lines: out };
}

// ── stock take ────────────────────────────────────────────────────────────

/** A count as typed → thousandths, null for "not counted", or the problem. Zero is a count: the shelf is empty. */
export function parseCount(text: string, unit: StockUnit): { counted: number | null } | { error: string } {
  if (text.trim() === '') return { counted: null };
  if (/^0*(\.0*)?$/u.test(text.trim())) return { counted: 0 };
  const parsed = parseStockQuantity(text, unit);
  if ('refused' in parsed) return { error: quantityProblem(parsed.refused, unit) };
  return { counted: parsed.quantity };
}
