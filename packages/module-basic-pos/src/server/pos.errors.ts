import { POS_PRICE_MAX, POS_QUANTITY_MAX } from '../domain/money.js';
import { POS_CONFLICT_MESSAGE } from '../domain/orders.js';
import { POS_CODE_MAX, POS_DESCRIPTION_MAX, POS_NAME_MAX, POS_NOTE_MAX, POS_REASON_MAX } from '../domain/text.js';
import type { PosRefusal } from '../types.js';

/**
 * One error type for every refusal a POS operation makes.
 *
 * A REASON CODE, not a message: the transport decides the wording's fate, and a
 * caller that has to regex a sentence gets it wrong on the first rewording.
 *
 * ⚠ The app sees only the MESSAGE (`formatError` strips `extensions` in
 * production), so the one refusal it must act on — a conflict, which reloads
 * the order — carries the exact message exported from the domain.
 */
export class PosWriteError extends Error {
  constructor(
    readonly reason: PosRefusal,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PosWriteError';
  }
}

/** The sentence for each refusal a domain check can return. */
export function refusalError(reason: PosRefusal, detail: Record<string, unknown> = {}): PosWriteError {
  return new PosWriteError(reason, refusalMessage(reason), detail);
}

/** Unwraps a domain `prepare*` / `plan*` result, throwing its refusal. */
export function unwrap<T extends object>(result: T | { refused: PosRefusal }): T {
  if ('refused' in result) throw refusalError(result.refused);
  return result;
}

const peso = (centavos: number) => `₱${(centavos / 100).toLocaleString('en-PH')}`;

function refusalMessage(reason: PosRefusal): string {
  switch (reason) {
    case 'not_found':
      return 'That does not exist in this store';
    case 'not_permitted':
      return 'You cannot do that here';
    case 'conflict':
      return POS_CONFLICT_MESSAGE;
    case 'limit_reached':
      return 'This store has as many items for sale as its plan allows — archive some first';
    case 'not_open':
      return 'That order is no longer open, so it cannot be changed';
    case 'not_unpaid':
      return 'Only an unpaid order can be voided';
    case 'not_paid':
      return 'Only a paid order can be refunded';
    case 'invalid_transition':
      return 'That order cannot be finished that way';
    case 'invalid_name':
      return `A name needs some text, at most ${POS_NAME_MAX} characters, with no invisible formatting`;
    case 'invalid_description':
      return `A description is at most ${POS_DESCRIPTION_MAX} characters, with no invisible formatting`;
    case 'invalid_kind':
      return 'An item is either a product or a service';
    case 'invalid_code':
      return `A code is at most ${POS_CODE_MAX} letters, digits and - _ . /`;
    case 'duplicate_code':
      return 'Another item or variant in this store already has that code';
    case 'invalid_price':
      return `A price is in whole centavos, from ₱0 to ${peso(POS_PRICE_MAX)}`;
    case 'invalid_cost':
      return `A cost is in whole centavos, from ₱0 to ${peso(POS_PRICE_MAX)}, or left empty`;
    case 'invalid_quantity':
      return `A quantity is a whole number from 1 to ${POS_QUANTITY_MAX}`;
    case 'invalid_note':
      return `A note is one line of at most ${POS_NOTE_MAX} characters`;
    case 'invalid_label':
      return 'A label is one short line';
    case 'invalid_contact':
      return 'A contact is one short line: a phone number or an email';
    case 'invalid_phone':
      return 'A phone number is one short line with the number in it';
    case 'invalid_email':
      return 'That is not an e-mail address, such as juan@example.com';
    case 'invalid_facebook':
      return 'Paste the customer’s Facebook or Messenger link, such as facebook.com/juan.delacruz';
    case 'invalid_reason':
      return `A reason is one line of at most ${POS_REASON_MAX} characters`;
    case 'invalid_discount':
      return 'A discount is an amount above ₱0, or a percentage from 0.01% to 100%';
    case 'invalid_amount':
      return 'Those amounts do not add up: check what was received, the tip and the change';
    case 'invalid_method':
      return 'Payment is cash, e-wallet or card';
    case 'insufficient_payment':
      return 'That is less than the total';
    case 'change_not_allowed':
      return 'E-wallet and card payments have no change: enter the total, plus any tip';
    case 'customer_required':
      return 'The customer’s name and contact are needed for that';
    case 'reason_required':
      return 'Give a reason';
    case 'variant_required':
      return 'Choose which one: this item comes in several variants';
    case 'item_archived':
      return 'That item is no longer for sale';
    case 'exceeds_sold':
      return 'That is more than was sold, counting earlier refunds';
    case 'exceeds_paid':
      return 'That is more than was paid, counting earlier refunds';
    case 'unknown_line':
      return 'Pick each line of this order once';
    case 'invalid_keymap':
      return 'Those shortcuts cannot be saved';
    case 'invalid_period':
      return 'A period covers whole store days, from one day to a little over a year';
  }
}
