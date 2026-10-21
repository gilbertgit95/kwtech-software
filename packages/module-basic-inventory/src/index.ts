/**
 * `@kwtech/module-basic-inventory` — a store's stock per workspace
 * (docs/INVENTORY-PLAN.md).
 *
 * THIS ENTRY POINT IS PURE DOMAIN. No Prisma, no Nest, no React: every function
 * here is a decision, testable with a literal. The server half and the web half
 * import these rather than restating them — the till's "3 left" is
 * `canStillMake`, a sale's movements are `planLineTakes`, a quantity typed on
 * any form is `parseStockQuantity` — and every rule is enforced on the server
 * even where a form also uses it to say why before Save.
 */

export * from './domain/guards.js';
export * from './domain/levels.js';
export * from './domain/moves.js';
export * from './domain/quantities.js';
export * from './domain/returns.js';
export * from './domain/sources.js';
export * from './domain/takes.js';
export * from './domain/text.js';
export * from './domain/uses.js';
export * from './feature-keys.js';
export * from './operations.js';
export * from './processes.js';
export * from './types.js';
export * from './views.js';
