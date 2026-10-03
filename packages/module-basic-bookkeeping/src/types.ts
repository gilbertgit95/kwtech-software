/**
 * The shapes the bookkeeping domain decides over (docs/BOOKKEEPING-PLAN.md).
 * Plain data, no framework, so the server half and the web half hold the same
 * rules.
 *
 * ⚠ MONEY IS AN INTEGER NUMBER OF CENTAVOS everywhere in this module: ₱12.50 is
 * `1250`. The same rule as the point of sale's, for the same reason: a float
 * cannot hold ₱0.10 exactly, and a ledger off by a centavo per entry never
 * balances again.
 *
 * ⚠ A DAY IS `YYYY-MM-DD`, never an instant. An entry happened on a day of the
 * WORKSPACE's calendar (PLAN §13, 2026-09-29), and is stored as a Postgres
 * `DATE`.
 */

/** A calendar day, `YYYY-MM-DD`. Compares as a string because it sorts as a date. */
export type BooksDay = string;

/**
 * Where the business keeps its money. Cash on hand is the sum of the three.
 *
 *   cash    — the drawer, the safe, the owner's envelope
 *   ewallet — GCash, Maya
 *   bank    — a bank account; card payments land here
 */
export type BooksPlace = 'cash' | 'ewallet' | 'bank';

/**
 * What one ledger entry is (BOOKKEEPING-PLAN §2). The kind decides the
 * direction (`entryDirection`) and which fields it needs (`checkBooksEntry`).
 *
 * Money IN:
 *   capital         — an investor puts money in. Raises their capital.
 *   sales           — money taken from customers. Counts in profit.
 *   loan_repayment  — a borrower pays some of a loan back.
 *   adjustment_in   — the count found more than the books say (or the opening balance).
 *
 * Money OUT:
 *   expense         — rent, power, wages, supplies. Counts against profit.
 *   purchase        — something that lasts or is resold: equipment, stock. NOT
 *                     an expense: stock is costed when sold, by the POS.
 *   refund          — money given back to a customer. Counts against profit.
 *   loan_out        — money lent to somebody (`BooksLoan`).
 *   payout          — an investor paid from their share of the profit.
 *   capital_return  — an investor given back part of what they put in.
 *   adjustment_out  — the count found less than the books say.
 *
 * Money MOVED: transfer — from one place to another (cash deposited at the bank).
 *
 * NO money moves (the investors' ledger only):
 *   profit_share    — an investor's part of a period's profit, now owed to them.
 *   reinvest        — an investor leaves owed profit in the business as capital.
 */
export type BooksEntryKind =
  | 'capital'
  | 'sales'
  | 'loan_repayment'
  | 'adjustment_in'
  | 'expense'
  | 'purchase'
  | 'refund'
  | 'loan_out'
  | 'payout'
  | 'capital_return'
  | 'adjustment_out'
  | 'transfer'
  | 'profit_share'
  | 'reinvest';

/**
 * How investors' shares of profit are decided (BOOKKEEPING-PLAN §3).
 *
 *   capital — by what each has put in: ₱15,000 of ₱25,000 is 60%
 *   agreed  — by a percentage the partners agreed ("50/50"). The app records the
 *             agreement; it does not decide it.
 */
export type BooksShareMode = 'capital' | 'agreed';

/** Why a bookkeeping operation was refused. One union for the module, carried by its one error class. */
export type BooksRefusal =
  | 'not_found'
  | 'not_permitted'
  | 'conflict'
  | 'invalid_kind'
  | 'invalid_amount'
  | 'invalid_place'
  | 'same_place'
  | 'invalid_day'
  | 'future_day'
  | 'day_shared'
  | 'invalid_name'
  | 'duplicate_name'
  | 'invalid_text'
  | 'invalid_category'
  | 'investor_required'
  | 'investor_former'
  | 'loan_required'
  | 'exceeds_owed'
  | 'exceeds_capital'
  | 'exceeds_loan'
  | 'invalid_share'
  | 'shares_incomplete'
  | 'no_investors'
  | 'no_profit'
  | 'invalid_kept'
  | 'invalid_period'
  | 'sales_not_recorded'
  | 'pos_not_connected'
  | 'pos_nothing_new'
  | 'pos_truncated'
  | 'not_latest'
  | 'already_voided'
  | 'reason_required'
  | 'part_of_share'
  | 'still_invested';
