/**
 * `@kwtech/module-file-manager` — the file manager sub-app (issue #138).
 *
 * THIS ENTRY POINT IS PURE DOMAIN. No Prisma, no Nest, no React, no Node
 * built-ins: every function here is a decision, testable with a literal. The
 * server, the web app's route handlers and the page import these rather than
 * restating them, and every rule is enforced on the server even where the page
 * also uses it to hide a button.
 */

export * from './domain/index.js';
export * from './feature-keys.js';
export * from './operations.js';
export * from './processes.js';
export * from './types.js';
