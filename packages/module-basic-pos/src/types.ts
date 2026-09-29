/**
 * The shapes the domain decides over (docs/POS-PLAN.md). Plain data, no
 * framework, so the server half and the web half hold the same rules.
 *
 * ⚠ MONEY IS AN INTEGER NUMBER OF CENTAVOS everywhere in this module: ₱12.50 is
 * `1250`. A float cannot hold ₱0.10 exactly, and a till that is off by a
 * centavo per sale is off by pesos per day (POS-PLAN §3).
 */

/** What an item is. In v1 only a label and a filter; it matters once stock arrives (services are never counted). */
export type PosItemKind = 'product' | 'service';

/**
 * Where an order is in its life (POS-PLAN §3, D13, D17).
 *
 *   open      — being built, or held. The only status whose lines may change.
 *   unpaid    — finalised by "Pay later": numbered and locked, the customer owes it.
 *   paid      — finalised and paid. Final; corrections are refunds.
 *   cancelled — an open order dropped. Never numbered, never counted as a sale.
 *   voided    — an unpaid order whose items came back. Keeps its number.
 */
export type PosOrderStatus = 'open' | 'unpaid' | 'paid' | 'cancelled' | 'voided';

/** How money was received or given back. Recorded, never processed (D6). */
export type PosPaymentMethod = 'cash' | 'ewallet' | 'card';

/**
 * A discount as the person gave it (D16).
 *
 *   amount  — `value` centavos off.
 *   percent — `value` BASIS POINTS off: 1000 is 10%, 1250 is 12.5%. An integer,
 *             so no float ever touches the arithmetic.
 */
export interface PosDiscount {
  kind: 'amount' | 'percent';
  value: number;
}

/** Why a POS operation was refused. One union for the module, carried by its one error class at the service boundary. */
export type PosRefusal =
  | 'not_found'
  | 'not_permitted'
  | 'conflict'
  | 'limit_reached'
  | 'not_open'
  | 'not_unpaid'
  | 'not_paid'
  | 'invalid_transition'
  | 'invalid_name'
  | 'invalid_kind'
  | 'invalid_code'
  | 'duplicate_code'
  | 'invalid_price'
  | 'invalid_cost'
  | 'invalid_quantity'
  | 'invalid_note'
  | 'invalid_label'
  | 'invalid_contact'
  | 'invalid_reason'
  | 'invalid_discount'
  | 'invalid_amount'
  | 'invalid_method'
  | 'insufficient_payment'
  | 'change_not_allowed'
  | 'customer_required'
  | 'reason_required'
  | 'variant_required'
  | 'item_archived'
  | 'exceeds_sold'
  | 'exceeds_paid'
  | 'unknown_line'
  | 'invalid_keymap'
  | 'invalid_time_zone'
  | 'invalid_period';
