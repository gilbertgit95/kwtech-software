import { checkAgreedShare } from '../../domain/balances.js';
import { prepareBooksDay } from '../../domain/days.js';
import { checkBooksAmount, isBooksPlace, prepareBooksEntry } from '../../domain/entries.js';
import { checkInvestorEntry, checkLoanRepayment } from '../../domain/investors.js';
import { prepareBooksName, prepareBooksText } from '../../domain/text.js';
import type { BooksEntryKind, BooksRefusal } from '../../types.js';
import type {
  BooksInvestorView,
  BooksLoanView,
  LendBooksMoneyInput,
  RecordBooksEntryInput,
  RecordBooksInvestorEntryInput,
  SaveBooksInvestorInput,
} from '../books-client.js';
import { parsePercent, parsePeso } from './money.js';

/**
 * The forms' drafts and their checks — the SAME domain checks the server runs
 * (`prepareBooksEntry`, `checkInvestorEntry`, …), so a form says why before
 * Save rather than after. The server checks again; these only spare a round
 * trip.
 *
 * Each `validate*` returns the input to send, or a per-field error map.
 */

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

type Validated<I, K extends string> = { input: I } | { errors: FieldErrors<K> };

/** A day's refusal, in the form's words. */
function dayError(raw: string, today: string): string | null {
  const day = prepareBooksDay(raw, today);
  if (!('refused' in day)) return null;
  return day.refused === 'future_day' ? 'That date has not come yet.' : 'Choose a date.';
}

/** An amount's refusal, in the form's words, or the centavos. */
function amountOf(raw: string): { amount: number } | { error: string } {
  const amount = parsePeso(raw);
  if (amount === null || checkBooksAmount(amount)) return { error: 'Enter an amount above ₱0, like 1500 or 1,500.50.' };
  return { amount };
}

/** Optional text as sent: trimmed, and null when nothing was typed. */
function orNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** A note, contact or reference's refusal, or null. */
function textError(raw: string): string | null {
  return 'refused' in prepareBooksText(raw) ? 'One line, at most 200 characters.' : null;
}

/** The field a domain refusal belongs to, and what it says there. */
function entryRefusal(refused: BooksRefusal): [EntryField, string] {
  switch (refused) {
    case 'invalid_place':
      return ['place', 'Choose where the money was.'];
    case 'same_place':
      return ['toPlace', 'Choose a different place to move it to.'];
    case 'invalid_category':
      return ['category', 'Say what it was for, in a few words.'];
    case 'loan_required':
      return ['loanId', 'Choose which loan is being repaid.'];
    default:
      return ['amount', 'Check this entry.'];
  }
}

export type EntryField =
  | 'kind'
  | 'amount'
  | 'place'
  | 'toPlace'
  | 'day'
  | 'category'
  | 'description'
  | 'reference'
  | 'loanId';

/** The "record money" form. */
export interface EntryDraft {
  kind: BooksEntryKind;
  amount: string;
  place: string;
  toPlace: string;
  day: string;
  category: string;
  description: string;
  reference: string;
  loanId: string;
}

export function emptyEntryDraft(kind: BooksEntryKind, today: string): EntryDraft {
  return {
    kind,
    amount: '',
    place: 'cash',
    toPlace: 'bank',
    day: today,
    category: '',
    description: '',
    reference: '',
    loanId: '',
  };
}

/**
 * The record form → the input to send, or why not. A repayment is also checked
 * against the loan's outstanding balance when the loan is known.
 */
export function validateEntryDraft(
  draft: EntryDraft,
  context: { today: string; clientId: string; loan?: BooksLoanView | null | undefined },
): Validated<RecordBooksEntryInput, EntryField> {
  const errors: FieldErrors<EntryField> = {};
  const money = amountOf(draft.amount);
  if ('error' in money) errors.amount = money.error;
  const day = dayError(draft.day, context.today);
  if (day) errors.day = day;
  for (const field of ['description', 'reference'] as const) {
    const error = textError(draft[field]);
    if (error) errors[field] = error;
  }
  if ('error' in money) return { errors };

  const isTransfer = draft.kind === 'transfer';
  const isRepayment = draft.kind === 'loan_repayment';
  const shape = prepareBooksEntry({
    kind: draft.kind,
    amount: money.amount,
    place: isBooksPlace(draft.place) ? draft.place : null,
    toPlace: isTransfer && isBooksPlace(draft.toPlace) ? draft.toPlace : null,
    investorId: null,
    loanId: isRepayment && draft.loanId ? draft.loanId : null,
    category: draft.category,
  });
  if ('refused' in shape) {
    const [field, message] = entryRefusal(shape.refused);
    errors[field] = message;
  }
  if (isRepayment && context.loan && checkLoanRepayment(money.amount, context.loan)) {
    errors.amount = 'That is more than is still owed on the loan.';
  }
  if (Object.keys(errors).length > 0 || 'refused' in shape) return { errors };

  return {
    input: {
      kind: draft.kind,
      amount: money.amount,
      place: draft.place,
      toPlace: isTransfer ? draft.toPlace : null,
      day: draft.day,
      category: shape.category,
      description: orNull(draft.description),
      reference: orNull(draft.reference),
      loanId: isRepayment ? draft.loanId : null,
      clientId: context.clientId,
    },
  };
}

export type InvestorEntryField = 'amount' | 'place' | 'day' | 'description' | 'reference';

/** The investor money form: capital in, a payout, a capital return, a reinvestment. */
export interface InvestorEntryDraft {
  kind: Extract<BooksEntryKind, 'capital' | 'payout' | 'capital_return' | 'reinvest'>;
  amount: string;
  place: string;
  day: string;
  description: string;
  reference: string;
  advance: boolean;
}

export function emptyInvestorEntryDraft(kind: InvestorEntryDraft['kind'], today: string): InvestorEntryDraft {
  return { kind, amount: '', place: 'cash', day: today, description: '', reference: '', advance: false };
}

/** What each refusal of `checkInvestorEntry` says on the form. */
const INVESTOR_REFUSAL: Partial<Record<BooksRefusal, string>> = {
  exceeds_owed: 'That is more than they are owed. Tick “advance” to pay ahead of profit.',
  exceeds_capital: 'That is more capital than they have in the business.',
  investor_former: 'They are a former investor. Restore them first.',
};

export function validateInvestorEntryDraft(
  draft: InvestorEntryDraft,
  investor: BooksInvestorView,
  context: { today: string; clientId: string },
): Validated<RecordBooksInvestorEntryInput, InvestorEntryField> {
  const errors: FieldErrors<InvestorEntryField> = {};
  const money = amountOf(draft.amount);
  if ('error' in money) errors.amount = money.error;
  const day = dayError(draft.day, context.today);
  if (day) errors.day = day;
  const movesMoney = draft.kind !== 'reinvest';
  if (movesMoney && !isBooksPlace(draft.place)) errors.place = 'Choose where the money was.';
  for (const field of ['description', 'reference'] as const) {
    const error = textError(draft[field]);
    if (error) errors[field] = error;
  }
  if ('amount' in money) {
    const refused = checkInvestorEntry(draft.kind, money.amount, {
      balance: investor,
      former: investor.formerAt !== null,
      advance: draft.kind === 'payout' && draft.advance,
    });
    if (refused) errors.amount = INVESTOR_REFUSAL[refused] ?? 'Check this amount.';
  }
  if (Object.keys(errors).length > 0 || 'error' in money) return { errors };
  return {
    input: {
      kind: draft.kind,
      investorId: investor.id,
      amount: money.amount,
      place: movesMoney ? draft.place : null,
      day: draft.day,
      description: orNull(draft.description),
      reference: orNull(draft.reference),
      advance: draft.kind === 'payout' && draft.advance,
      clientId: context.clientId,
    },
  };
}

export type LendField = 'borrowerName' | 'contact' | 'note' | 'amount' | 'place' | 'day' | 'description';

/** Lending: to a new borrower (`loanId` empty) or more to one already owing. */
export interface LendDraft {
  loanId: string;
  borrowerName: string;
  contact: string;
  note: string;
  amount: string;
  place: string;
  day: string;
  description: string;
}

export function emptyLendDraft(today: string, loanId = ''): LendDraft {
  return { loanId, borrowerName: '', contact: '', note: '', amount: '', place: 'cash', day: today, description: '' };
}

export function validateLendDraft(
  draft: LendDraft,
  context: { today: string; clientId: string },
): Validated<LendBooksMoneyInput, LendField> {
  const errors: FieldErrors<LendField> = {};
  const isNew = draft.loanId === '';
  if (isNew && 'refused' in prepareBooksName(draft.borrowerName)) errors.borrowerName = 'Who is borrowing it?';
  for (const field of ['contact', 'note', 'description'] as const) {
    const error = textError(draft[field]);
    if (error) errors[field] = error;
  }
  const money = amountOf(draft.amount);
  if ('error' in money) errors.amount = money.error;
  if (!isBooksPlace(draft.place)) errors.place = 'Choose where the money came from.';
  const day = dayError(draft.day, context.today);
  if (day) errors.day = day;
  if (Object.keys(errors).length > 0 || 'error' in money) return { errors };
  return {
    input: {
      ...(isNew
        ? { borrowerName: draft.borrowerName, contact: orNull(draft.contact), note: orNull(draft.note) }
        : { loanId: draft.loanId }),
      amount: money.amount,
      place: draft.place,
      day: draft.day,
      description: orNull(draft.description),
      clientId: context.clientId,
    },
  };
}

export type InvestorField = 'name' | 'contact' | 'note' | 'agreedShare';

export interface InvestorDraft {
  name: string;
  contact: string;
  note: string;
  /** A percentage as typed ("50", "33.33"), or empty for "not agreed". */
  agreedShare: string;
}

export function validateInvestorDraft(
  draft: InvestorDraft,
  investorId: string | null,
): Validated<SaveBooksInvestorInput, InvestorField> {
  const errors: FieldErrors<InvestorField> = {};
  if ('refused' in prepareBooksName(draft.name)) errors.name = 'Give their name, at most 120 characters.';
  for (const field of ['contact', 'note'] as const) {
    const error = textError(draft[field]);
    if (error) errors[field] = error;
  }
  const typed = draft.agreedShare.trim();
  const agreedShare = typed === '' ? null : parsePercent(typed);
  if (typed !== '' && (agreedShare === null || checkAgreedShare(agreedShare))) {
    errors.agreedShare = 'A percentage from 0 to 100, like 50 or 33.33 — or leave it empty.';
  }
  if (Object.keys(errors).length > 0) return { errors };
  return {
    input: {
      ...(investorId ? { investorId } : {}),
      name: draft.name,
      contact: orNull(draft.contact),
      note: orNull(draft.note),
      agreedShare,
    },
  };
}

/** A fresh client id for a form, so a second press records nothing new. */
export function newClientId(): string {
  return crypto.randomUUID();
}
