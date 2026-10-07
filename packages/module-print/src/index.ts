/**
 * `@kwtech/module-print` — a workspace's printing side: the computers paired to
 * print for it, and the printers they report.
 *
 * THIS ENTRY POINT IS PURE DOMAIN. No Prisma, no Nest, no React: every function
 * here is a decision or a piece of arithmetic, testable with a literal. The
 * server half, the web half and the print agent (`apps/print-agent`) import
 * these rather than restating them.
 */

export * from './domain/agents.js';
export * from './domain/jobs.js';
export * from './domain/pairing.js';
export * from './domain/printers.js';
export * from './domain/ruler.js';
export * from './feature-keys.js';
export * from './operations.js';
export * from './types.js';
