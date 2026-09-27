/**
 * `@kwtech/module-note/server` — everything a NestJS app needs.
 *
 * `@nestjs/common` and `@nestjs/graphql` are OPTIONAL peers: importing the
 * package root resolves nothing from here, so a consumer that only wants the
 * domain rules installs no framework.
 */

export * from './graphql/note.resolver.js';
export * from './graphql/note.types.js';
export * from './note.errors.js';
export * from './note.events.js';
export * from './note.module.js';
export * from './note.options.js';
export * from './note.pubsub.js';
export * from './note.repository.js';
export * from './note.service.js';
export * from './note.tokens.js';
export * from './note-write.service.js';
export * from './ports.js';
export * from './server-module.js';
