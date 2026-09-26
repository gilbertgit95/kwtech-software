/**
 * `@kwtech/module-app-hub` — a workspace's Apps page: every sub-app the viewer
 * holds, in tabs or side by side in a grid of up to six cells, with a saved
 * workspace default and a per-person override.
 *
 * THIS ENTRY POINT IS PURE DOMAIN. No Prisma, no Nest, no React: the layout
 * rules are decisions testable with a literal, and both the page and the
 * server import them rather than restating them.
 */

export * from './domain/layout.js';
export * from './feature-keys.js';
export * from './operations.js';
