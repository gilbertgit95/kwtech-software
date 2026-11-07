/**
 * `@kwtech/module-platform-billing` — billing for the whole application: an
 * organization requests a plan, pays outside the app, and platform staff
 * approve it (`docs/PLATFORM-BILLING-PLAN.md`).
 *
 * THIS ENTRY POINT IS PURE DOMAIN. No Prisma, no Nest, no React: every function
 * here is a decision, testable with a literal. Phase 2 (#91) is this entry
 * point alone; the server half (phase 4) and the pages (phases 6 and 7) import
 * these rules rather than restating them. It imports only `@kwtech/module-kit`.
 */

export * from './domain/access.js';
export * from './domain/days.js';
export * from './domain/money.js';
export * from './domain/payments.js';
export * from './domain/periods.js';
export * from './domain/plans.js';
export * from './domain/quotes.js';
export * from './domain/refusals.js';
export * from './domain/requests.js';
export * from './feature-keys.js';
