import { BOOKS_AMOUNT_MAX } from '../domain/entries.js';
import { BOOKS_CATEGORY_MAX, BOOKS_NAME_MAX, BOOKS_TEXT_MAX } from '../domain/text.js';
import type { BooksRefusal } from '../types.js';

/**
 * One error type for every refusal a bookkeeping operation makes.
 *
 * A REASON CODE, not a message: the transport decides the wording's fate, and a
 * caller that has to regex a sentence gets it wrong on the first rewording.
 *
 * ⚠ The app sees only the MESSAGE (`formatError` strips `extensions` in
 * production), so every message is a sentence a person can act on.
 */
export class BooksWriteError extends Error {
  constructor(
    readonly reason: BooksRefusal,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'BooksWriteError';
  }
}

/** The error for a refusal, in its one sentence. */
export function refusalError(reason: BooksRefusal, detail: Record<string, unknown> = {}): BooksWriteError {
  return new BooksWriteError(reason, booksRefusalMessage(reason), detail);
}

/** Unwraps a domain `prepare*` result, throwing its refusal. */
export function unwrap<T extends object>(result: T | { refused: BooksRefusal }): T {
  if ('refused' in result) throw refusalError(result.refused);
  return result;
}

const peso = (centavos: number) => `₱${(centavos / 100).toLocaleString('en-PH')}`;

/**
 * The sentence for each refusal. Exported because the profit-share PREVIEW
 * answers a refusal as data, not as an error, and must say it the same way.
 */
export function booksRefusalMessage(reason: BooksRefusal): string {
  switch (reason) {
    case 'not_found':
      return 'That does not exist in these books';
    case 'not_permitted':
      return 'You cannot do that here';
    case 'conflict':
      return 'Somebody else changed the books at the same moment — look again, then try once more';
    case 'invalid_kind':
      return 'That kind of entry cannot be recorded here';
    case 'invalid_amount':
      return `An amount is above ₱0, in whole centavos, and at most ${peso(BOOKS_AMOUNT_MAX)}`;
    case 'invalid_place':
      return 'Say where the money was: cash, e-wallet or bank';
    case 'same_place':
      return 'A transfer moves money between two different places';
    case 'invalid_day':
      return 'That is not a date';
    case 'future_day':
      return 'That date has not come yet — record money once it has moved';
    case 'day_shared':
      return 'The profit up to that date has already been shared, so sales, refunds, expenses and capital before it are closed. Date it later, or void that profit share first';
    case 'invalid_name':
      return `A name needs some text, at most ${BOOKS_NAME_MAX} characters, with no invisible formatting`;
    case 'duplicate_name':
      return 'There is already an investor with that name';
    case 'invalid_text':
      return `A note, contact or reference is one line of at most ${BOOKS_TEXT_MAX} characters`;
    case 'invalid_category':
      return `Say what the money was for, in at most ${BOOKS_CATEGORY_MAX} characters`;
    case 'investor_required':
      return 'Choose which investor this is for';
    case 'investor_former':
      return 'That person is a former investor — restore them first';
    case 'loan_required':
      return 'Choose which loan this is for';
    case 'exceeds_owed':
      return 'That is more than they are owed — mark it an advance to pay ahead of profit';
    case 'exceeds_capital':
      return 'That is more capital than they have in the business';
    case 'exceeds_loan':
      return 'That is more than is still owed on the loan';
    case 'invalid_share':
      return 'A share is a percentage from 0% to 100%';
    case 'shares_incomplete':
      return 'Give every current investor an agreed share, adding up to exactly 100%';
    case 'no_investors':
      return 'There is nobody to share with: add an investor and their capital first';
    case 'no_profit':
      return 'There is no profit to share in that period';
    case 'invalid_kept':
      return 'What is kept in the business is from ₱0 to the whole profit';
    case 'invalid_period':
      return 'Choose a last day from the first day not yet covered, up to today, and at most a year';
    case 'sales_not_recorded':
      return 'Bring in the point of sale’s sales up to that day first, so the profit is complete';
    case 'pos_not_connected':
      return 'This workspace does not bring sales in from a point of sale — record them by hand, or choose a first day in the settings';
    case 'pos_nothing_new':
      return 'Those days are already in the books';
    case 'pos_truncated':
      return 'The point of sale has too many orders in those days to count at once — bring in fewer days';
    case 'not_latest':
      return 'Only the latest one can be voided — void the later ones first';
    case 'already_voided':
      return 'That was already voided';
    case 'reason_required':
      return 'Give a reason';
    case 'part_of_share':
      return 'That is part of a profit share — void the whole share instead';
    case 'still_invested':
      return 'They still have capital in the business — return it first';
  }
}
