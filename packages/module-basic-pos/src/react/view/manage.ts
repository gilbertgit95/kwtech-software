import { POS_KEY_ACTIONS, type PosKeyAction, type PosKeyZone } from '../../domain/keymap.js';
import type { PosCategoryView, PosItemInput, PosItemView, PosOrderSummaryView, PosOrderView } from '../pos-client.js';
import { parsePeso, pesoInputValue } from './money.js';

/**
 * The management sections' decisions (D23), pure so they are tested rather
 * than hoped for — this repo has no React render tests. The components only
 * draw what these return.
 */

// ── orders ──────────────────────────────────────────────────────────────────

/** The Orders section's tabs, in the bar's order; the keys are the API's `tab`. */
export const ORDER_TABS = [
  { key: 'today', label: 'Today' },
  { key: 'pending', label: 'Pending' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'change_owed', label: 'Change owed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
] as const;

export type OrderTab = (typeof ORDER_TABS)[number]['key'];

/** How a status reads, and which colour tells it apart at a glance. */
export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/**
 * One order's status as a chip. "Change owed" and a refund outrank "Paid":
 * the list is where somebody looks for what still needs doing.
 */
export function orderStatusChip(
  order: Pick<PosOrderSummaryView, 'status' | 'changeOwed' | 'refunded' | 'total'> & {
    changeSettlement?: string | null;
  },
): { label: string; tone: StatusTone } {
  switch (order.status) {
    case 'open':
      return { label: 'Pending', tone: 'info' };
    case 'unpaid':
      return { label: 'Unpaid', tone: 'warning' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'neutral' };
    case 'voided':
      return { label: 'Voided', tone: 'neutral' };
    default: {
      // ⚠ The summary has no settlement: its `changeOwed` is already only what is still owed.
      const owed = order.changeOwed > 0 && !order.changeSettlement;
      if (owed) return { label: 'Change owed', tone: 'warning' };
      if (order.refunded >= order.total && order.refunded > 0) return { label: 'Refunded', tone: 'danger' };
      if (order.refunded > 0) return { label: 'Partly refunded', tone: 'danger' };
      return { label: 'Paid', tone: 'success' };
    }
  }
}

/** "#12", or the label or customer for an order with no number yet (open, or cancelled while open). */
export function orderTitle(order: Pick<PosOrderSummaryView, 'number' | 'label' | 'customerName'>): string {
  if (order.number !== null) return `#${order.number}`;
  return order.label ?? order.customerName ?? 'Walk-in';
}

/** What may be done to an order from the Orders section, for the person looking (D23, "actions live on the thing"). */
export interface OrderActions {
  resume: boolean;
  takePayment: boolean;
  voidOrder: boolean;
  refund: boolean;
  settleChange: boolean;
  reprint: boolean;
}

export function orderActions(
  order: Pick<PosOrderView, 'status' | 'changeOwed' | 'changeSettlement' | 'total' | 'refunded'>,
  can: { sell: boolean; refund: boolean },
): OrderActions {
  const paid = order.status === 'paid';
  return {
    resume: order.status === 'open' && can.sell,
    takePayment: order.status === 'unpaid' && can.sell,
    voidOrder: order.status === 'unpaid' && can.refund,
    refund: paid && can.refund && order.refunded < order.total,
    settleChange: paid && can.sell && order.changeOwed > 0 && order.changeSettlement === null,
    reprint: paid || order.status === 'unpaid',
  };
}

/** An instant in the WORKSPACE's zone ("30 Sep 2026, 3:04 PM"), never the browser's. */
export function whenText(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-PH', { timeZone, dateStyle: 'medium', timeStyle: 'short' });
}

// ── items ───────────────────────────────────────────────────────────────────

/** A variant as typed: prices as text until saved. */
export interface VariantForm {
  /** Null for one added in this form. */
  id: string | null;
  /** Keys a row across reorders before it has an id. */
  key: string;
  name: string;
  code: string;
  price: string;
  cost: string;
}

/** An item as typed. */
export interface ItemForm {
  id: string | null;
  kind: 'product' | 'service';
  name: string;
  code: string;
  description: string;
  categoryId: string;
  price: string;
  cost: string;
  variants: VariantForm[];
}

let variantKeys = 0;

/** A fresh key for a new variant row. A counter, not the clock: two rows added in one tick differ. */
export function newVariantKey(): string {
  variantKeys += 1;
  return `new-${variantKeys}`;
}

/** The form for an item, or a blank one. Only LIVE variants: an archived one comes back by re-adding it. */
export function itemForm(item: PosItemView | null): ItemForm {
  if (!item) {
    return {
      id: null,
      kind: 'product',
      name: '',
      code: '',
      description: '',
      categoryId: '',
      price: '',
      cost: '',
      variants: [],
    };
  }
  return {
    id: item.id,
    kind: item.kind === 'service' ? 'service' : 'product',
    name: item.name,
    code: item.code ?? '',
    description: item.description ?? '',
    categoryId: item.categoryId ?? '',
    price: pesoInputValue(item.price),
    cost: item.cost === null ? '' : pesoInputValue(item.cost),
    variants: item.variants
      .filter((variant) => variant.archivedAt === null)
      .map((variant) => ({
        id: variant.id,
        key: variant.id,
        name: variant.name,
        code: variant.code ?? '',
        price: pesoInputValue(variant.price),
        cost: variant.cost === null ? '' : pesoInputValue(variant.cost),
      })),
  };
}

/**
 * The form as the API's input, or the first problem in words.
 *
 * Only what the SCREEN can know is checked here (a name, an amount that
 * parses); caps, codes in use and the item limit are the server's, and its
 * refusal is shown as it comes.
 *
 * ⚠ THE VARIANT LIST IS SENT WHOLE, always: the server archives an existing
 * variant left out. A cost field left empty is "not entered" (null), never ₱0.
 *
 * ⚠ COSTS ARE ALWAYS SENT, and a save writes them: only `pos:manage_items`
 * reaches the Items section, and that key is the one that sees costs (D15).
 * Were somebody without it ever given this form, their empty cost fields
 * would clear real costs — so the section stays behind that key.
 */
export function itemInput(form: ItemForm): { input: PosItemInput } | { problem: string } {
  if (form.name.trim() === '') return { problem: 'An item needs a name.' };
  const hasVariants = form.variants.length > 0;
  const price = hasVariants && form.price.trim() === '' ? 0 : parsePeso(form.price);
  if (price === null) return { problem: 'The price is not an amount, such as 15 or 15.50.' };
  const cost = optionalPeso(form.cost);
  if (cost === undefined) return { problem: 'The cost is not an amount. Leave it empty if you do not know it.' };

  const variants: NonNullable<PosItemInput['variants']> = [];
  for (const [index, variant] of form.variants.entries()) {
    const where = `Variant ${index + 1}`;
    if (variant.name.trim() === '') return { problem: `${where} needs a name.` };
    const variantPrice = parsePeso(variant.price);
    if (variantPrice === null) return { problem: `${where}: the price is not an amount.` };
    const variantCost = optionalPeso(variant.cost);
    if (variantCost === undefined) return { problem: `${where}: the cost is not an amount.` };
    variants.push({
      ...(variant.id ? { id: variant.id } : {}),
      name: variant.name,
      code: variant.code.trim() === '' ? null : variant.code,
      price: variantPrice,
      cost: variantCost,
    });
  }

  return {
    input: {
      ...(form.id ? { id: form.id } : {}),
      kind: form.kind,
      name: form.name,
      code: form.code.trim() === '' ? null : form.code,
      description: form.description.trim() === '' ? null : form.description,
      price,
      cost,
      categoryId: form.categoryId === '' ? null : form.categoryId,
      variants,
    },
  };
}

/** Empty → null ("not entered"); an amount → centavos; anything else → undefined (refused). */
function optionalPeso(text: string): number | null | undefined {
  if (text.trim() === '') return null;
  return parsePeso(text) ?? undefined;
}

/** Moves one entry of a list up or down, returning a new list. Out of range: the same list. */
export function moveEntry<T>(list: readonly T[], index: number, direction: 'up' | 'down'): T[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(index, 1);
  if (moved === undefined) return [...list];
  next.splice(target, 0, moved);
  return next;
}

/** Items for the Items list: by name, filtered by a search over name, code and category. */
export function filterItems(
  items: readonly PosItemView[],
  categories: readonly PosCategoryView[],
  search: string,
  showArchived: boolean,
): PosItemView[] {
  const needle = search.trim().toLowerCase();
  const categoryName = new Map(categories.map((category) => [category.id, category.name.toLowerCase()]));
  return items
    .filter((item) => showArchived || item.archivedAt === null)
    .filter((item) => {
      if (!needle) return true;
      const haystack = [
        item.name,
        item.code ?? '',
        categoryName.get(item.categoryId ?? '') ?? '',
        ...item.variants.map((variant) => `${variant.name} ${variant.code ?? ''}`),
      ]
        .join(' ')
        .toLowerCase();
      return needle.split(/\s+/u).every((word) => haystack.includes(word));
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The saves that put `categories` in the order given: each category's new
 * `sortOrder` is its position, and only those that changed are saved. Two
 * categories with the same sort order (as seeded) get distinct ones.
 */
export function categoryReorder(
  ordered: readonly PosCategoryView[],
): { id: string; name: string; sortOrder: number }[] {
  return ordered
    .map((category, index) => ({ category, index }))
    .filter(({ category, index }) => category.sortOrder !== index)
    .map(({ category, index }) => ({ id: category.id, name: category.name, sortOrder: index }));
}

// ── hot keys ────────────────────────────────────────────────────────────────

/** Where each zone's keys work, as the Hot keys screen explains it. */
export const KEY_ZONE_LABELS: Readonly<Record<PosKeyZone, string>> = {
  global: 'Anywhere at the till (function keys only, so search can still be typed in)',
  cart: 'With a line selected in the order',
  payment: 'On the payment screen',
  receipt: 'After a sale',
};

/** The actions grouped by zone, in the keymap's own order. */
export function actionsByZone(): { zone: PosKeyZone; actions: { action: PosKeyAction; label: string }[] }[] {
  const zones: PosKeyZone[] = ['global', 'cart', 'payment', 'receipt'];
  return zones.map((zone) => ({
    zone,
    actions: (Object.keys(POS_KEY_ACTIONS) as PosKeyAction[])
      .filter((action) => POS_KEY_ACTIONS[action].zone === zone)
      .map((action) => ({ action, label: POS_KEY_ACTIONS[action].label })),
  }));
}

/**
 * What an item key rings up, in words, or why it is broken: the item or the
 * variant was archived after the key was set (D18, "shown as broken in
 * settings and does nothing at the till").
 */
export function itemKeyTarget(
  target: { itemId: string; variantId: string | null },
  items: readonly PosItemView[],
): { label: string; broken: boolean } {
  const item = items.find((candidate) => candidate.id === target.itemId);
  if (!item) return { label: 'An item that no longer exists', broken: true };
  const variant = target.variantId ? item.variants.find((candidate) => candidate.id === target.variantId) : null;
  if (target.variantId && !variant) return { label: `${item.name} — a removed variant`, broken: true };
  const label = variant ? `${item.name} — ${variant.name}` : item.name;
  const archived = item.archivedAt !== null || (variant?.archivedAt ?? null) !== null;
  return { label: archived ? `${label} (archived)` : label, broken: archived };
}
