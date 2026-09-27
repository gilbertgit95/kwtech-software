/**
 * `@kwtech/module-note` — notes per workspace.
 *
 * THIS ENTRY POINT IS PURE DOMAIN. No Prisma, no Nest, no React: every function
 * here is a decision, testable with a literal. The server half and the web half
 * import these rather than restating them, and every rule is enforced on the
 * server even where the app also uses it to hide a button.
 */

export * from './domain/access.js';
export * from './domain/appearance.js';
export * from './domain/notes.js';
export * from './domain/search.js';
export * from './domain/tags.js';
export * from './feature-keys.js';
export * from './types.js';
