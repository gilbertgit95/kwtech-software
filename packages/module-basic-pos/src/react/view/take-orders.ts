import { availableFirst, isPosItemAvailable } from '../../domain/availability.js';
import type {
  PosCatalogueView,
  PosItemView,
  PosOrderLineView,
  PosOrderSummaryView,
  PosOrderTypeOptionView,
} from '../pos-client.js';
import { gridItems, sellOrder } from './till.js';

/**
 * The rules of the Take orders view (issue #23): the seller's screen, made for
 * a phone or a handheld. Items are grouped by their category, a group opens
 * and closes with one tap, and every order ends at Hold for a cashier to pay.
 */

/** The group of items with no category. Not a category id: those are cuids. */
export const POS_UNGROUPED = 'ungrouped';

/** One expandable group on the Take orders view: a category and what it sells. */
export interface PosItemGroup {
  /** The category's id, or `POS_UNGROUPED`. */
  id: string;
  name: string;
  items: PosItemView[];
}

/**
 * The items to sell, grouped by category (issue #21's "beef ▸ bulalo,
 * balbacua"): the categories in the store's order, each item by name, and
 * the uncategorised ones last as "Other". A group with nothing to sell is
 * left out, so an empty heading never has to be opened to find that out.
 *
 * ⚠ An item whose category is archived goes under Other rather than out of
 * sight: archiving a category must never take its items off the till.
 *
 * Not available (issue #37): inside each group those items come after the
 * ones that can be sold, and a group with NOTHING to sell right now comes
 * after the groups that still have something. Both follow the switch live.
 */
export function itemGroups(catalogue: PosCatalogueView): PosItemGroup[] {
  const live = catalogue.categories
    .filter((category) => category.archivedAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const liveIds = new Set(live.map((category) => category.id));
  const items = sellOrder(gridItems(catalogue, null));
  const groups: PosItemGroup[] = live.map((category) => ({
    id: category.id,
    name: category.name,
    items: items.filter((item) => item.categoryId === category.id),
  }));
  groups.push({
    id: POS_UNGROUPED,
    name: groups.length === 0 ? 'Items' : 'Other',
    items: items.filter((item) => item.categoryId === null || !liveIds.has(item.categoryId)),
  });
  return availableFirst(
    groups.filter((group) => group.items.length > 0),
    (group) => group.items.some(isPosItemAvailable),
  );
}

/**
 * The groups open when the view arrives: all of them when there is only one,
 * since a single closed heading is a tap that shows nothing new, and none
 * otherwise, so a phone sees every heading without scrolling.
 */
export function initiallyOpenGroups(groups: readonly Pick<PosItemGroup, 'id'>[]): ReadonlySet<string> {
  return new Set(groups.length === 1 ? groups.map((group) => group.id) : []);
}

/** How many of an item (any variant) are on the order: the count on its row, so a seller sees what is in. */
export function countOnOrder(lines: readonly Pick<PosOrderLineView, 'itemId' | 'quantity'>[], itemId: string): number {
  return lines.filter((line) => line.itemId === itemId).reduce((sum, line) => sum + line.quantity, 0);
}

/** The order types a seller can pick, in the store's order: archived ones are never offered. */
export function liveOrderTypes(catalogue: Pick<PosCatalogueView, 'orderTypes'>): PosOrderTypeOptionView[] {
  return catalogue.orderTypes
    .filter((type) => type.archivedAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/**
 * The line under a held order's title: its type and how much is on it —
 * "Dine-in · 3 items". The type first, since it tells the cashier what kind
 * of order it is before anything else.
 */
export function heldOrderDetail(order: Pick<PosOrderSummaryView, 'orderTypeName' | 'itemCount'>): string {
  const items = `${order.itemCount} ${order.itemCount === 1 ? 'item' : 'items'}`;
  return order.orderTypeName ? `${order.orderTypeName} · ${items}` : items;
}

/** What a held order is called on its chip: the reference, else the customer, else its number. */
export function heldOrderTitle(order: Pick<PosOrderSummaryView, 'label' | 'customerName' | 'number'>): string {
  if (order.label) return order.label;
  if (order.customerName) return order.customerName;
  return order.number === null ? 'No reference' : `Order ${order.number}`;
}

/**
 * Whether the order on the screen may be set aside for a new one as it is.
 *
 * ⚠ AN ORDER NEVER HELD IS LISTED NOWHERE: it is saved from its first line,
 * but only this device knows it (`use-till`'s remembered id). Leaving it for
 * a new order would strand it, so it must be held first. An empty one, or
 * one already held, is safe to leave.
 */
export function canLeaveOrder(
  order: { id: string; lines: readonly unknown[] } | null,
  held: readonly Pick<PosOrderSummaryView, 'id'>[],
): boolean {
  if (!order || order.lines.length === 0) return true;
  return held.some((one) => one.id === order.id);
}

/**
 * The ways Sell shows on the full screen (issue #23): Cashier, and the
 * keyboard till as it was, kept as an option (the operator, 2026-10-29).
 * Take orders is not one of them: it is the phone's, and Cashier does all it
 * does on a big screen.
 */
export type PosSellMode = 'cashier' | 'classic';

/**
 * Which one Sell opens with: the one this device last showed, when the person
 * may still use it, else Cashier for somebody who may take payment and
 * Classic for everybody else (the till without Pay, ending at Hold).
 *
 * ⚠ A remembered Cashier never opens for somebody who lost `pos:take_payment`:
 * it would offer a board whose every payment the server refuses. Anything
 * else remembered — "take_orders" from before it left the full screen — is
 * read as nothing.
 */
export function sellModeFor(saved: string | null, canTakePayment: boolean): PosSellMode {
  if (saved === 'classic') return 'classic';
  if (saved === 'cashier' && canTakePayment) return 'cashier';
  return canTakePayment ? 'cashier' : 'classic';
}

/**
 * How pressing a held order is, by how long it has waited (issue #23). In a
 * restaurant a table eats for half an hour or more before it pays, so a new
 * order is calm, and the cashier's eye goes to the oldest.
 */
export type PosWaitUrgency = 'new' | 'waiting' | 'long' | 'overdue';

/**
 * Where each urgency starts, in minutes waited. Fixed for now: a meal is about
 * half an hour, an hour is long, two is an order somebody forgot.
 */
export const POS_WAIT_MINUTES = { waiting: 30, long: 60, overdue: 120 } as const;

/** Whole minutes an order has waited, never below 0 (a device clock a little behind the server's). */
export function waitMinutes(sinceIso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(sinceIso).getTime()) / 60_000));
}

export function waitUrgency(minutes: number): PosWaitUrgency {
  if (minutes >= POS_WAIT_MINUTES.overdue) return 'overdue';
  if (minutes >= POS_WAIT_MINUTES.long) return 'long';
  if (minutes >= POS_WAIT_MINUTES.waiting) return 'waiting';
  return 'new';
}

/**
 * How long, to the minute: "just now", "12 min", "1 h 20 min", "1 d 3 h".
 * Exact where `sinceText` rounds ("1 h ago"): the cashier compares orders by it.
 */
export function waitText(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days} d` : `${days} d ${hours % 24} h`;
}

/**
 * How long a name may be before its row offers ⓘ: past this, the row's two
 * lines can cut it. A guess by length, not a measurement — measuring every
 * row's text after layout would cost a pass per row for a hint.
 */
export const POS_LONG_NAME_CHARS = 40;

/**
 * Whether an item's row offers ⓘ, a sheet with its whole text (the operator,
 * 2026-10-29): the row cuts a long name and the description with "…", so an
 * item with a description, or a name past `POS_LONG_NAME_CHARS`, has more to
 * read than the row shows.
 */
export function hasMoreToRead(item: Pick<PosItemView, 'name' | 'description'>): boolean {
  return Boolean(item.description?.trim()) || item.name.trim().length > POS_LONG_NAME_CHARS;
}
