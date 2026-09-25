/**
 * `@kwtech/module-notification` — system notifications for a person, across
 * every organization and workspace.
 *
 * THIS ENTRY POINT IS PURE DOMAIN. No Prisma, no Nest, no React: every function
 * here is a decision, testable with a literal. The server half (`/server`) and
 * the web half (`/react`) import these rather than restating them.
 */

export * from './domain/actions.js';
export * from './domain/browser-notify.js';
export * from './domain/bulk.js';
export * from './domain/compose.js';
export * from './domain/context.js';
export * from './domain/flood.js';
export * from './domain/grouping.js';
export * from './domain/live-state.js';
export * from './domain/ordering.js';
export * from './domain/sources.js';
export * from './domain/toast.js';
export * from './domain/unread.js';
export * from './feature-keys.js';
export * from './operations.js';
export * from './types.js';
