/**
 * `@kwtech/module-queuing-window` — a walk-in queue per workspace.
 *
 * THIS ENTRY POINT IS PURE DOMAIN. No Prisma, no Nest, no React: every function
 * here is a decision, testable with a literal. The server half (step 4) and the
 * web half (step 6) import these rather than restating them, and every rule is
 * enforced on the server even where the console also uses it to hide a button.
 */

export * from './domain/lines.js';
export * from './domain/nicknames.js';
export * from './domain/numbering.js';
export * from './domain/seats.js';
export * from './domain/session.js';
export * from './domain/text.js';
export * from './domain/tickets.js';
export * from './domain/voice.js';
export * from './domain/windows.js';
export * from './feature-keys.js';
export * from './operations.js';
export * from './types.js';
