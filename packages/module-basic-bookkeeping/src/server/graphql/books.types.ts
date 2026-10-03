import { Field, Float, InputType, Int, ObjectType } from '@nestjs/graphql';

/*
 * The bookkeeping GraphQL shapes. Code-first, filled from `books.views.ts`.
 * Kinds, places and modes cross as documented STRINGS (no `registerEnumType`),
 * days as `YYYY-MM-DD`, moments as ISO strings.
 *
 * ⚠ MONEY IS `Float` HOLDING WHOLE CENTAVOS. GraphQL's `Int` is 32-bit, which
 * caps at ₱21,474,836.47 — one capital entry can pass it. A double holds every
 * integer up to 2^53 exactly, and the server refuses anything that is not a
 * safe integer (`checkBooksAmount`), so no fraction ever lands.
 */

@ObjectType('BooksMoney')
export class BooksMoneyType {
  @Field(() => Float)
  cash!: number;

  @Field(() => Float)
  ewallet!: number;

  @Field(() => Float)
  bank!: number;

  /** Cash on hand: the three together. May be negative — something is not recorded yet. */
  @Field(() => Float)
  total!: number;
}

@ObjectType('BooksProfit')
export class BooksProfitType {
  @Field(() => Float)
  sales!: number;

  @Field(() => Float)
  refunds!: number;

  @Field(() => Float)
  costOfGoods!: number;

  @Field(() => Float)
  expenses!: number;

  /** Sales − refunds − cost of goods − expenses. Negative is a loss. */
  @Field(() => Float)
  profit!: number;

  /** Shown beside profit, never in it. */
  @Field(() => Float)
  purchases!: number;
}

@ObjectType('BooksMonthProfit')
export class BooksMonthProfitType extends BooksProfitType {
  /** `YYYY-MM`. */
  @Field()
  month!: string;
}

@ObjectType('BooksInvestor')
export class BooksInvestorType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  contact!: string | null;

  @Field(() => String, { nullable: true })
  note!: string | null;

  /** Basis points, or null when none was agreed. */
  @Field(() => Int, { nullable: true })
  agreedShare!: number | null;

  @Field(() => String, { nullable: true })
  formerAt!: string | null;

  @Field(() => Float)
  putIn!: number;

  @Field(() => Float)
  reinvested!: number;

  @Field(() => Float)
  capitalReturned!: number;

  /** Put in + reinvested − returned. */
  @Field(() => Float)
  capital!: number;

  @Field(() => Float)
  profitShared!: number;

  @Field(() => Float)
  paidOut!: number;

  /** What the business still owes them. Negative is an advance. */
  @Field(() => Float)
  owed!: number;

  /** Their share of profit now, in basis points; null when shares cannot be worked out. */
  @Field(() => Int, { nullable: true })
  share!: number | null;
}

@ObjectType('BooksLoan')
export class BooksLoanType {
  @Field()
  id!: string;

  @Field()
  borrowerName!: string;

  @Field(() => String, { nullable: true })
  contact!: string | null;

  @Field(() => String, { nullable: true })
  note!: string | null;

  @Field(() => Float)
  lent!: number;

  @Field(() => Float)
  repaid!: number;

  @Field(() => Float)
  outstanding!: number;

  @Field(() => String, { nullable: true })
  lastDay!: string | null;

  @Field()
  createdAt!: string;
}

@ObjectType('BooksSharePart')
export class BooksSharePartType {
  @Field()
  investorId!: string;

  /** Basis points. */
  @Field(() => Int)
  share!: number;

  @Field(() => Float)
  amount!: number;
}

@ObjectType('BooksProfitShare')
export class BooksProfitShareType {
  @Field()
  id!: string;

  @Field()
  fromDay!: string;

  @Field()
  toDay!: string;

  @Field(() => Float)
  sales!: number;

  @Field(() => Float)
  refunds!: number;

  @Field(() => Float)
  costOfGoods!: number;

  @Field(() => Float)
  expenses!: number;

  @Field(() => Float)
  profit!: number;

  @Field(() => Float)
  kept!: number;

  @Field(() => Float)
  shared!: number;

  /** Empty for a voided share. */
  @Field(() => [BooksSharePartType])
  parts!: BooksSharePartType[];

  @Field()
  recordedById!: string;

  @Field(() => String, { nullable: true })
  recordedByName!: string | null;

  @Field()
  recordedAt!: string;

  @Field(() => String, { nullable: true })
  voidedAt!: string | null;

  @Field(() => String, { nullable: true })
  voidReason!: string | null;
}

@ObjectType('BooksPosStatus')
export class BooksPosStatusType {
  /** This app has a point of sale to read. */
  @Field()
  available!: boolean;

  /** A first day was chosen: sales come in from the POS. */
  @Field()
  connected!: boolean;

  @Field(() => String, { nullable: true })
  importFrom!: string | null;

  @Field(() => String, { nullable: true })
  recordedThrough!: string | null;

  @Field(() => String, { nullable: true })
  nextFromDay!: string | null;
}

@ObjectType('BooksOverview')
export class BooksOverviewType {
  @Field()
  timeZone!: string;

  @Field()
  today!: string;

  @Field(() => BooksMoneyType)
  money!: BooksMoneyType;

  /** `capital` or `agreed`. */
  @Field()
  shareMode!: string;

  @Field(() => String, { nullable: true })
  sharedThrough!: string | null;

  @Field(() => [BooksInvestorType])
  investors!: BooksInvestorType[];

  @Field(() => Float)
  owedToInvestors!: number;

  @Field(() => [BooksLoanType])
  loans!: BooksLoanType[];

  @Field(() => Float)
  lentOutstanding!: number;

  @Field(() => String, { nullable: true })
  unsharedFrom!: string | null;

  @Field(() => BooksProfitType, { nullable: true })
  unshared!: BooksProfitType | null;

  @Field(() => [BooksMonthProfitType])
  months!: BooksMonthProfitType[];

  @Field(() => [BooksProfitShareType])
  shares!: BooksProfitShareType[];

  @Field(() => BooksPosStatusType)
  pos!: BooksPosStatusType;

  /** True when there were more entries than one read adds up: the balances are a lower bound. */
  @Field()
  truncated!: boolean;
}

@ObjectType('BooksEntry')
export class BooksEntryType {
  @Field()
  id!: string;

  /** A `BooksEntryKind`: `capital`, `sales`, `expense`, `payout`, … */
  @Field()
  kind!: string;

  @Field(() => Float)
  amount!: number;

  /** `cash`, `ewallet` or `bank`; null for a profit share or a reinvestment. */
  @Field(() => String, { nullable: true })
  place!: string | null;

  @Field(() => String, { nullable: true })
  toPlace!: string | null;

  @Field()
  day!: string;

  @Field(() => String, { nullable: true })
  category!: string | null;

  @Field(() => String, { nullable: true })
  description!: string | null;

  @Field(() => String, { nullable: true })
  reference!: string | null;

  @Field(() => String, { nullable: true })
  investorId!: string | null;

  @Field(() => String, { nullable: true })
  loanId!: string | null;

  @Field(() => String, { nullable: true })
  importId!: string | null;

  @Field(() => String, { nullable: true })
  shareId!: string | null;

  @Field()
  advance!: boolean;

  @Field()
  recordedById!: string;

  @Field(() => String, { nullable: true })
  recordedByName!: string | null;

  @Field()
  recordedAt!: string;

  @Field(() => String, { nullable: true })
  voidedAt!: string | null;

  @Field(() => String, { nullable: true })
  voidedById!: string | null;

  @Field(() => String, { nullable: true })
  voidedByName!: string | null;

  @Field(() => String, { nullable: true })
  voidReason!: string | null;
}

@ObjectType('BooksEntries')
export class BooksEntriesType {
  @Field(() => [BooksEntryType])
  entries!: BooksEntryType[];

  /** Cash on hand before the first entry, for a month; 0 for an investor's or a loan's entries. */
  @Field(() => Float)
  opening!: number;

  @Field()
  truncated!: boolean;
}

@ObjectType('BooksSalesImport')
export class BooksSalesImportType {
  @Field()
  id!: string;

  @Field()
  fromDay!: string;

  @Field()
  toDay!: string;

  @Field(() => Float)
  cash!: number;

  @Field(() => Float)
  ewallet!: number;

  @Field(() => Float)
  bank!: number;

  @Field(() => Float)
  costOfGoods!: number;

  /** Basis points of the sales that had a cost. */
  @Field(() => Int)
  costCoverage!: number;

  @Field(() => Int)
  orders!: number;

  @Field()
  recordedAt!: string;

  @Field(() => String, { nullable: true })
  voidedAt!: string | null;
}

@ObjectType('BooksPosSales')
export class BooksPosSalesType {
  @Field()
  fromDay!: string;

  @Field()
  toDay!: string;

  @Field(() => Float)
  cash!: number;

  @Field(() => Float)
  ewallet!: number;

  @Field(() => Float)
  bank!: number;

  @Field(() => Float)
  costOfGoods!: number;

  @Field(() => Int)
  costCoverage!: number;

  @Field(() => Int)
  orders!: number;

  /** True: the POS had too many orders to count; recording is refused. */
  @Field()
  truncated!: boolean;
}

@ObjectType('BooksProfitSharePlan')
export class BooksProfitSharePlanType {
  @Field()
  ok!: boolean;

  /** Why it cannot be shared, in a sentence; null when it can. */
  @Field(() => String, { nullable: true })
  refusal!: string | null;

  @Field(() => String, { nullable: true })
  fromDay!: string | null;

  @Field()
  toDay!: string;

  @Field(() => BooksProfitType, { nullable: true })
  profit!: BooksProfitType | null;

  @Field(() => Float)
  kept!: number;

  @Field(() => Float)
  shared!: number;

  @Field(() => [BooksSharePartType])
  parts!: BooksSharePartType[];
}

@ObjectType('BooksSettings')
export class BooksSettingsType {
  @Field()
  shareMode!: string;

  @Field(() => String, { nullable: true })
  posImportFrom!: string | null;

  @Field(() => Int)
  version!: number;
}

@ObjectType('BooksEvent')
export class BooksEventType {
  /** `books`, or `sync` on (re)subscribe: either way, read again. */
  @Field()
  kind!: string;

  @Field(() => String, { nullable: true })
  actorId!: string | null;
}

@InputType('RecordBooksEntryInput')
export class RecordBooksEntryInputType {
  /** `sales`, `refund`, `expense`, `purchase`, `transfer`, `adjustment_in`, `adjustment_out` or `loan_repayment`. */
  @Field()
  kind!: string;

  @Field(() => Float)
  amount!: number;

  @Field()
  place!: string;

  @Field(() => String, { nullable: true })
  toPlace?: string | null;

  @Field()
  day!: string;

  @Field(() => String, { nullable: true })
  category?: string | null;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => String, { nullable: true })
  reference?: string | null;

  @Field(() => String, { nullable: true })
  loanId?: string | null;

  @Field()
  clientId!: string;
}

@InputType('RecordBooksInvestorEntryInput')
export class RecordBooksInvestorEntryInputType {
  /** `capital`, `payout`, `capital_return` or `reinvest`. */
  @Field()
  kind!: string;

  @Field()
  investorId!: string;

  @Field(() => Float)
  amount!: number;

  /** Null for a reinvestment. */
  @Field(() => String, { nullable: true })
  place?: string | null;

  @Field()
  day!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => String, { nullable: true })
  reference?: string | null;

  @Field(() => Boolean, { nullable: true })
  advance?: boolean | null;

  @Field()
  clientId!: string;
}

@InputType('LendBooksMoneyInput')
export class LendBooksMoneyInputType {
  /** Omit to lend to a new borrower. */
  @Field(() => String, { nullable: true })
  loanId?: string | null;

  @Field(() => String, { nullable: true })
  borrowerName?: string | null;

  @Field(() => String, { nullable: true })
  contact?: string | null;

  @Field(() => String, { nullable: true })
  note?: string | null;

  @Field(() => Float)
  amount!: number;

  @Field()
  place!: string;

  @Field()
  day!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => String, { nullable: true })
  reference?: string | null;

  @Field()
  clientId!: string;
}

@InputType('SaveBooksInvestorInput')
export class SaveBooksInvestorInputType {
  /** Omit for a new investor. */
  @Field(() => String, { nullable: true })
  investorId?: string | null;

  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  contact?: string | null;

  @Field(() => String, { nullable: true })
  note?: string | null;

  /** Basis points; null for "not agreed". */
  @Field(() => Int, { nullable: true })
  agreedShare?: number | null;
}
