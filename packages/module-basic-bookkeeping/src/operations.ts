/**
 * Every GraphQL document this module sends, as data.
 *
 * A document is the ONE part of a typed client that nothing typechecks: a
 * renamed field or a moved argument is a runtime refusal on a screen. Lifted out
 * here, the host hands every one of them to `graphql`'s own validator against
 * the schema it serves — `apps/web-server/test/module-operations.test.ts`.
 *
 * ⚠ FRAMEWORK-FREE, and exported from the package ROOT rather than `/react`, so
 * a server validating them never resolves React to read a string.
 */

const MONEY = 'cash ewallet bank total';
const PROFIT = 'sales refunds costOfGoods expenses profit purchases';
const INVESTOR =
  'id name contact note agreedShare formerAt putIn reinvested capitalReturned capital profitShared paidOut owed share';
const LOAN = 'id borrowerName contact note lent repaid outstanding lastDay createdAt';
const PART = 'investorId share amount';
const SHARE = `id fromDay toDay sales refunds costOfGoods expenses profit kept shared parts { ${PART} } recordedById recordedByName recordedAt voidedAt voidReason`;
const ENTRY =
  'id kind amount place toPlace day category description reference investorId loanId importId shareId advance recordedById recordedByName recordedAt voidedAt voidedById voidedByName voidReason';
const POS_STATUS = 'available connected importFrom recordedThrough nextFromDay';
const IMPORT = 'id fromDay toDay cash ewallet bank costOfGoods costCoverage orders recordedAt voidedAt';
const POS_SALES = 'fromDay toDay cash ewallet bank costOfGoods costCoverage orders truncated';
const SETTINGS = 'shareMode posImportFrom version';
const SCOPE_VARS = '$organizationId: String!, $workspaceId: String!';
const SCOPE_ARGS = 'organizationId: $organizationId, workspaceId: $workspaceId';

export const BOOKS_OPERATIONS = {
  // ── reading ───────────────────────────────────────────────────────────────

  /** Everything the overview, investors and loans show: balances added up from every entry. */
  booksOverview: `query BooksOverview(${SCOPE_VARS}) {
    booksOverview(${SCOPE_ARGS}) {
      timeZone today money { ${MONEY} } shareMode sharedThrough
      investors { ${INVESTOR} } owedToInvestors
      loans { ${LOAN} } lentOutstanding
      unsharedFrom unshared { ${PROFIT} }
      months { month ${PROFIT} }
      shares { ${SHARE} }
      pos { ${POS_STATUS} }
      truncated
    }
  }`,

  /** One month of the ledger (`month`), or one investor's or one loan's entries. Voided ones included. */
  booksEntries: `query BooksEntries(${SCOPE_VARS}, $month: String, $investorId: String, $loanId: String) {
    booksEntries(${SCOPE_ARGS}, month: $month, investorId: $investorId, loanId: $loanId) {
      entries { ${ENTRY} } opening truncated
    }
  }`,

  // ── recording the day's money ─────────────────────────────────────────────

  recordBooksEntry: `mutation RecordBooksEntry(${SCOPE_VARS}, $input: RecordBooksEntryInput!) {
    recordBooksEntry(${SCOPE_ARGS}, input: $input) { ${ENTRY} }
  }`,

  /** Lend money: to a new borrower (no `loanId`), or more to one already owing. */
  lendBooksMoney: `mutation LendBooksMoney(${SCOPE_VARS}, $input: LendBooksMoneyInput!) {
    lendBooksMoney(${SCOPE_ARGS}, input: $input) { ${LOAN} }
  }`,

  saveBooksLoan: `mutation SaveBooksLoan(${SCOPE_VARS}, $loanId: String!, $borrowerName: String!, $contact: String, $note: String) {
    saveBooksLoan(${SCOPE_ARGS}, loanId: $loanId, borrowerName: $borrowerName, contact: $contact, note: $note) { ${LOAN} }
  }`,

  voidBooksEntry: `mutation VoidBooksEntry(${SCOPE_VARS}, $entryId: String!, $reason: String!) {
    voidBooksEntry(${SCOPE_ARGS}, entryId: $entryId, reason: $reason) { ${ENTRY} }
  }`,

  // ── the point of sale's sales ─────────────────────────────────────────────

  /** What bringing the POS's sales in through `toDay` would record. Nothing is written. */
  booksPosSalesPreview: `query BooksPosSalesPreview(${SCOPE_VARS}, $toDay: String!) {
    booksPosSalesPreview(${SCOPE_ARGS}, toDay: $toDay) { ${POS_SALES} }
  }`,

  recordBooksPosSales: `mutation RecordBooksPosSales(${SCOPE_VARS}, $toDay: String!, $clientId: String!) {
    recordBooksPosSales(${SCOPE_ARGS}, toDay: $toDay, clientId: $clientId) { ${IMPORT} }
  }`,

  // ── investors ─────────────────────────────────────────────────────────────

  saveBooksInvestor: `mutation SaveBooksInvestor(${SCOPE_VARS}, $input: SaveBooksInvestorInput!) {
    saveBooksInvestor(${SCOPE_ARGS}, input: $input) { ${INVESTOR} }
  }`,

  setBooksInvestorFormer: `mutation SetBooksInvestorFormer(${SCOPE_VARS}, $investorId: String!, $former: Boolean!) {
    setBooksInvestorFormer(${SCOPE_ARGS}, investorId: $investorId, former: $former) { ${INVESTOR} }
  }`,

  /** Capital in, a payout, a capital return or a reinvestment. */
  recordBooksInvestorEntry: `mutation RecordBooksInvestorEntry(${SCOPE_VARS}, $input: RecordBooksInvestorEntryInput!) {
    recordBooksInvestorEntry(${SCOPE_ARGS}, input: $input) { ${ENTRY} }
  }`,

  saveBooksSettings: `mutation SaveBooksSettings(${SCOPE_VARS}, $shareMode: String!, $posImportFrom: String) {
    saveBooksSettings(${SCOPE_ARGS}, shareMode: $shareMode, posImportFrom: $posImportFrom) { ${SETTINGS} }
  }`,

  // ── sharing profit ────────────────────────────────────────────────────────

  /** What sharing the profit through `toDay`, keeping `kept`, would give each investor — or why it cannot. */
  booksProfitSharePreview: `query BooksProfitSharePreview(${SCOPE_VARS}, $toDay: String!, $kept: Float!) {
    booksProfitSharePreview(${SCOPE_ARGS}, toDay: $toDay, kept: $kept) {
      ok refusal fromDay toDay profit { ${PROFIT} } kept shared parts { ${PART} }
    }
  }`,

  shareBooksProfit: `mutation ShareBooksProfit(${SCOPE_VARS}, $toDay: String!, $kept: Float!, $clientId: String!) {
    shareBooksProfit(${SCOPE_ARGS}, toDay: $toDay, kept: $kept, clientId: $clientId) { ${SHARE} }
  }`,

  voidBooksProfitShare: `mutation VoidBooksProfitShare(${SCOPE_VARS}, $shareId: String!, $reason: String!) {
    voidBooksProfitShare(${SCOPE_ARGS}, shareId: $shareId, reason: $reason) { ${SHARE} }
  }`,

  // ── live ──────────────────────────────────────────────────────────────────

  /** Ids and facts only: the client reads again through the guarded queries. */
  booksEvents: `subscription BooksEvents(${SCOPE_VARS}) {
    booksEvents(${SCOPE_ARGS}) { kind actorId }
  }`,
} as const;

export type BooksOperationName = keyof typeof BOOKS_OPERATIONS;
