/**
 * `@kwtech/module-print-studio` — a layout studio per workspace.
 *
 * THIS ENTRY POINT IS PURE DOMAIN. No Prisma, no Nest, no React: every function
 * here is a decision or a piece of arithmetic, testable with a literal. The
 * server half and the web half import these rather than restating them, and
 * every rule about what may be SAVED is enforced on the server even where the
 * app also uses it to draw the editor.
 */

export * from './domain/access.js';
export * from './domain/adjust.js';
export * from './domain/border.js';
export * from './domain/calibration.js';
export * from './domain/fill.js';
export * from './domain/keymap.js';
export * from './domain/layout.js';
export * from './domain/log.js';
export * from './domain/page-layout.js';
export * from './domain/papers.js';
export * from './domain/place.js';
export * from './domain/presets.js';
export * from './domain/sizes.js';
export * from './domain/slot-fit.js';
export * from './domain/tags.js';
export * from './domain/units.js';
export * from './feature-keys.js';
export * from './operations.js';
export * from './processes.js';
export * from './types.js';
