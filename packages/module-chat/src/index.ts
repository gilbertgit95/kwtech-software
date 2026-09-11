/**
 * `@kwtech/module-chat` — user-to-user and group messaging.
 *
 * PURE DOMAIN TODAY. No Prisma, no Nest, no React: every function here is a
 * decision, testable with a literal, and the server that will wrap it in step 4
 * imports these rather than restating them.
 *
 * That ordering is deliberate — `canAccessConversation` gets tests before it
 * gets a screen, because C1's exact failure was a helper that existed, was
 * exported, was used by the React layer, and was never called server-side.
 */

export * from './domain/blocking.js';
export * from './domain/conversations.js';
export * from './domain/messages.js';
export * from './domain/participation.js';
export * from './feature-keys.js';
export * from './types.js';
