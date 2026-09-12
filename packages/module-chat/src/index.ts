/**
 * `@kwtech/module-chat` — user-to-user and group messaging.
 *
 * THIS ENTRY POINT IS PURE DOMAIN. No Prisma, no Nest, no React: every
 * function here is a decision, testable with a literal, and both the server
 * (`/server`) and the web half (`/react`) import these rather than restating
 * them.
 *
 * That ordering is deliberate — `canAccessConversation` got tests before it got
 * a screen, because C1's exact failure was a helper that existed, was exported,
 * was used by the React layer, and was never called server-side.
 */

export * from './defaults.js';
export * from './domain/availability.js';
export * from './domain/blocking.js';
export * from './domain/conversations.js';
export * from './domain/messages.js';
export * from './domain/participant-roles.js';
export * from './domain/participation.js';
export * from './enabled.js';
export * from './feature-keys.js';
export * from './operations.js';
export * from './types.js';
