/**
 * `@kwtech/module-basic-pos` — a point of sale per workspace (docs/POS-PLAN.md).
 *
 * THIS ENTRY POINT IS PURE DOMAIN. No Prisma, no Nest, no React: every function
 * here is a decision, testable with a literal. The server half and the web half
 * import these rather than restating them — the till shows the total
 * `computeOrderTotals` gives, and the server stores the total it gives — and
 * every rule is enforced on the server even where the till also uses it to
 * hide a button.
 */

export * from './domain/keymap.js';
export * from './domain/money.js';
export * from './domain/orders.js';
export * from './domain/refunds.js';
export * from './domain/reports.js';
export * from './domain/search.js';
export * from './domain/text.js';
export * from './feature-keys.js';
export * from './operations.js';
export * from './types.js';
