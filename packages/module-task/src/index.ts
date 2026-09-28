/**
 * `@kwtech/module-task` — task boards per workspace.
 *
 * THIS ENTRY POINT IS PURE DOMAIN. No Prisma, no Nest, no React: every function
 * here is a decision, testable with a literal. The server half and the web half
 * import these rather than restating them, and every rule is enforced on the
 * server even where the app also uses it to hide a button.
 */

export * from './domain/access.js';
export * from './domain/boards.js';
export * from './domain/dates.js';
export * from './domain/events.js';
export * from './domain/labels.js';
export * from './domain/rank.js';
export * from './domain/tasks.js';
export * from './domain/text.js';
export * from './feature-keys.js';
export * from './operations.js';
export * from './types.js';
