import { STOCK_CODE_MAX, STOCK_NAME_MAX, STOCK_TEXT_MAX } from '../domain/text.js';
import type { StockRefusal } from '../types.js';

/**
 * One error type for every refusal a stock operation makes.
 *
 * A REASON CODE, not a message: the transport decides the wording's fate, and a
 * caller that has to regex a sentence gets it wrong on the first rewording.
 *
 * ⚠ The app sees only the MESSAGE (`formatError` strips `extensions` in
 * production), so every message is a sentence a person can act on.
 */
export class StockWriteError extends Error {
  constructor(
    readonly reason: StockRefusal,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'StockWriteError';
  }
}

/** The error for a refusal, in its one sentence. */
export function refusalError(reason: StockRefusal, detail: Record<string, unknown> = {}): StockWriteError {
  return new StockWriteError(reason, stockRefusalMessage(reason), detail);
}

/** Unwraps a domain `prepare*` result, throwing its refusal. */
export function unwrap<T extends object>(result: T | { refused: StockRefusal }): T {
  if ('refused' in result) throw refusalError(result.refused);
  return result;
}

/** The sentence for each refusal. Exported so a form can say it the same way. */
export function stockRefusalMessage(reason: StockRefusal): string {
  switch (reason) {
    case 'not_found':
      return 'That is not in this store’s stock';
    case 'not_permitted':
      return 'You cannot do that here';
    case 'archived':
      return 'That stock item is archived — restore it first';
    case 'invalid_name':
      return `A name needs some text, at most ${STOCK_NAME_MAX} characters, with no invisible formatting`;
    case 'invalid_kind':
      return 'Choose what the item is for, the unit it is counted in, and a reason from the list';
    case 'invalid_code':
      return `A code is letters, digits, - _ . or /, at most ${STOCK_CODE_MAX} characters`;
    case 'code_taken':
      return 'Another stock item already has that code';
    case 'invalid_text':
      return `A supplier, reference or note is one line of at most ${STOCK_TEXT_MAX} characters`;
    case 'reason_required':
      return 'Give a reason';
    case 'note_required':
      return 'Say what happened — “Other” needs a note';
    case 'invalid_quantity':
      return 'A quantity is a number above zero, with at most three decimals, up to a million';
    case 'whole_units_only':
      return 'Pieces, sheets and packs are counted whole';
    case 'invalid_cost':
      return 'A cost is ₱0 or more, in whole centavos, up to ₱1,000,000';
    case 'invalid_low_stock':
      return 'A low-stock level is above zero, or left empty for no alert';
    case 'duplicate_use':
      return 'Each stock item appears once on a list — change its quantity instead';
    case 'no_change':
      return 'There is nothing to record';
    case 'take_closed':
      return 'That stock take is already confirmed or abandoned';
    case 'take_open':
      return 'A stock take is already open — confirm or abandon it first';
    case 'unit_in_use':
      return 'The unit cannot change once stock has moved: every movement is counted in it. Archive this item and add a new one';
    case 'category_archived':
      return 'That category is archived — choose another, or restore it';
    case 'limit_reached':
      return 'This store has as many stock items as its plan allows — archive some first';
    case 'no_source':
      return 'This workspace has no point of sale to take products from';
  }
}
