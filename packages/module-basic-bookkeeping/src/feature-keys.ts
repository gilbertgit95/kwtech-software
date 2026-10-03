import type { FeatureContribution } from '@kwtech/module-kit';

/**
 * What the books let somebody do (docs/BOOKKEEPING-PLAN.md).
 *
 * ⚠ WORKSPACE LEVEL, like every sub-app's: an app always lives under a
 * workspace, and the Apps page asks the key of the workspace in the URL. A
 * workspace key is also FILTERED BY THE PLAN.
 *
 * ⚠ EVEN READING IS A KEY THAT ORDINARY MEMBERS DO NOT HOLD. The books say who
 * put in how much, who is owed what and who borrowed: a cashier needs none of
 * it. Keys are split by risk — seeing, recording the day's money, and the
 * owners' money (capital, payouts, sharing profit).
 */
export const BOOKS_FEATURE = {
  /** Open the app: cash on hand, the ledger, investors, loans and profit. */
  read: 'books:read',
  /**
   * Record the business's day-to-day money — sales, refunds, expenses,
   * purchases, transfers, count adjustments, loans and repayments — bring in
   * the point of sale's sales, and void a mistake.
   */
  record: 'books:record',
  /**
   * The owners' money: add investors, record capital, pay them out, return
   * capital, reinvest, set how profit is shared, and share it.
   */
  manageInvestors: 'books:manage_investors',
} as const;

export type BooksFeatureKey = (typeof BOOKS_FEATURE)[keyof typeof BOOKS_FEATURE];

const op = (identifier: string) => ({ surface: 'graphql_operation', identifier });

/**
 * Contributed to the app's composed registry (`seed/registry.ts`).
 *
 * ⚠ THE BINDINGS ARE THE GUARD. This module cannot use `@RequireFeature` (it
 * belongs to `module-permissions`, and a module may not import a module, §9),
 * so `FeatureGuard` enforces each operation through its binding. A missing
 * binding is an UNGUARDED OPERATION, which is why `surface-coverage.test.ts`
 * fails on any operation that is not bound here.
 */
export const BOOKS_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: BOOKS_FEATURE.read,
    module: 'books',
    level: 'workspace',
    label: 'See the books',
    description:
      'Open the bookkeeping app: cash on hand, every entry, the investors and what they are owed, loans, and profit.',
    tags: ['books'],
    bindings: [
      op('Query.booksOverview'),
      op('Query.booksEntries'),
      /*
       * ⚠ ITS OWN SURFACE. A subscription is authorised ONCE, here, and then
       * streams — ids only, filtered to the workspace.
       */
      { surface: 'graphql_subscription', identifier: 'Subscription.booksEvents' },
    ],
  },
  {
    key: BOOKS_FEATURE.record,
    module: 'books',
    level: 'workspace',
    label: 'Record money in and out',
    description:
      'Record sales, refunds, expenses, purchases, transfers, count adjustments, loans and repayments, bring in the point of sale’s sales, and void a mistake.',
    tags: ['books'],
    bindings: [
      op('Mutation.recordBooksEntry'),
      op('Mutation.lendBooksMoney'),
      op('Mutation.saveBooksLoan'),
      /*
       * ⚠ Voiding an INVESTOR's entry (capital, a payout, a capital return, a
       * reinvestment) also takes `books:manage_investors`: the service asks the
       * access port, and refuses without it. This key voids the day's money.
       */
      op('Mutation.voidBooksEntry'),
      op('Query.booksPosSalesPreview'),
      op('Mutation.recordBooksPosSales'),
    ],
  },
  {
    key: BOOKS_FEATURE.manageInvestors,
    module: 'books',
    /*
     * ⚠ PRIVILEGED because it pays money out to the owners and decides who is
     * owed what — the two acts a quietly emptied business hides behind.
     */
    isPrivileged: true,
    level: 'workspace',
    label: 'Manage investors and profit',
    description:
      'Add investors, record their capital, pay them out, give capital back, reinvest, set how profit is shared, and share it.',
    tags: ['books'],
    bindings: [
      op('Mutation.saveBooksInvestor'),
      op('Mutation.setBooksInvestorFormer'),
      op('Mutation.recordBooksInvestorEntry'),
      op('Mutation.saveBooksSettings'),
      op('Query.booksProfitSharePreview'),
      op('Mutation.shareBooksProfit'),
      op('Mutation.voidBooksProfitShare'),
    ],
  },
];

/**
 * A workspace role a host MAY create, exported as data and never seeded by this
 * module. The app's `seed/app-roles.ts` reads it.
 */
export interface BooksRolePreset {
  key: string;
  label: string;
  icon: string;
  level: 'workspace';
  features: readonly BooksFeatureKey[];
}

/**
 * ⚠ THE OWNER HOLDS EVERY BOOKKEEPER KEY. Grants add up and there is no deny,
 * so a business with no bookkeeper runs the books with the owner's role alone.
 */
export const BOOKS_ROLE_PRESETS: readonly BooksRolePreset[] = [
  {
    key: 'books-bookkeeper',
    label: 'Bookkeeper',
    icon: 'wallet',
    level: 'workspace',
    features: [BOOKS_FEATURE.read, BOOKS_FEATURE.record],
  },
  {
    key: 'books-owner',
    label: 'Books owner',
    icon: 'wallet',
    level: 'workspace',
    features: [BOOKS_FEATURE.read, BOOKS_FEATURE.record, BOOKS_FEATURE.manageInvestors],
  },
];
