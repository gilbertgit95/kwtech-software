import { isBooksPlace } from '../../domain/entries.js';
import { isInvestorEntryKind } from '../../domain/investors.js';
import type { BooksEntryKind, BooksPlace } from '../../types.js';
import type { BooksEntryView, BooksOverviewView } from '../books-client.js';
import { isKnownKind } from './labels.js';

/**
 * Entries off the wire, made ready for the statements in `src/domain/` — the
 * same sums the server runs — and the small decisions the ledger makes per
 * line.
 */

/** An entry as the statements add it up, carrying its view for the screen. */
export interface BooksLedgerLine {
  view: BooksEntryView;
  kind: BooksEntryKind;
  amount: number;
  place: BooksPlace | null;
  toPlace: BooksPlace | null;
  /** Voided — or of a kind this build does not know, which it then counts for nothing rather than guess. */
  voided: boolean;
}

export function ledgerLines(entries: readonly BooksEntryView[]): BooksLedgerLine[] {
  return entries.map((view) => {
    const known = isKnownKind(view.kind);
    return {
      view,
      kind: known ? (view.kind as BooksEntryKind) : 'transfer',
      amount: view.amount,
      place: view.place !== null && isBooksPlace(view.place) ? view.place : null,
      toPlace: view.toPlace !== null && isBooksPlace(view.toPlace) ? view.toPlace : null,
      voided: view.voidedAt !== null || !known,
    };
  });
}

/**
 * Whether the ledger offers "Void" on a line — the server's rule, shown: not
 * once voided; never a profit share's part (its whole share is voided from
 * Investors); an investor's money only with `books:manage_investors`; anything
 * else with `books:record`. The server refuses what this hides anyway.
 */
export function canVoidEntry(
  entry: Pick<BooksEntryView, 'kind' | 'voidedAt'>,
  can: { canRecord: boolean; canManage: boolean },
): boolean {
  if (entry.voidedAt !== null || !can.canRecord) return false;
  if (entry.kind === 'profit_share') return false;
  if (isKnownKind(entry.kind) && isInvestorEntryKind(entry.kind)) return can.canManage;
  return true;
}

/** Investor and borrower names for ledger lines, from the overview. */
export function entryNames(overview: Pick<BooksOverviewView, 'investors' | 'loans'>) {
  const investors = new Map(overview.investors.map((investor) => [investor.id, investor.name]));
  const borrowers = new Map(overview.loans.map((loan) => [loan.id, loan.borrowerName]));
  return {
    of(entry: Pick<BooksEntryView, 'investorId' | 'loanId'>): { investor: string | null; borrower: string | null } {
      return {
        investor: entry.investorId ? (investors.get(entry.investorId) ?? null) : null,
        borrower: entry.loanId ? (borrowers.get(entry.loanId) ?? null) : null,
      };
    },
  };
}
