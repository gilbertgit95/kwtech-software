/**
 * `@kwtech/module-platform-billing` — billing for the whole application: an
 * organization requests a plan, pays outside the app, and platform staff
 * approve it (`docs/PLATFORM-BILLING-PLAN.md`).
 *
 * THIS ENTRY POINT IS PURE DOMAIN. No Prisma, no Nest, no React: every function
 * here is a decision, testable with a literal, plus the GraphQL documents the
 * pages send (`operations.ts`). The server half is `/server` (#93); the pages
 * (phases 6 and 7) import these rules rather than restating them. It imports
 * only `@kwtech/module-kit`.
 */

export * from './domain/access.js';
export * from './domain/archives.js';
export * from './domain/comparison.js';
export * from './domain/days.js';
export * from './domain/documents.js';
export * from './domain/money.js';
export * from './domain/notices.js';
export * from './domain/payments.js';
export * from './domain/periods.js';
export * from './domain/plans.js';
export * from './domain/pricing.js';
export * from './domain/quotes.js';
export * from './domain/refusals.js';
export * from './domain/reports.js';
export * from './domain/requests.js';
export * from './domain/standing.js';
export * from './domain/statement.js';
export * from './domain/voids.js';
export * from './feature-keys.js';
export * from './operations.js';
export * from './processes.js';
