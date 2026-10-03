/**
 * `@kwtech/module-basic-bookkeeping` — a business's money per workspace
 * (docs/BOOKKEEPING-PLAN.md).
 *
 * THIS ENTRY POINT IS PURE DOMAIN. No Prisma, no Nest, no React: every function
 * here is a decision, testable with a literal. The server half and the web half
 * import these rather than restating them — the overview shows the cash on hand
 * `moneyOnHand` adds up, and a profit share stores what `planProfitShare`
 * planned — and every rule is enforced on the server even where a form also
 * uses it to say why before Save.
 */

export * from './domain/balances.js';
export * from './domain/days.js';
export * from './domain/entries.js';
export * from './domain/investors.js';
export * from './domain/profit.js';
export * from './domain/statements.js';
export * from './domain/text.js';
export * from './feature-keys.js';
export * from './operations.js';
export * from './types.js';
