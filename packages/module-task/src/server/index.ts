/**
 * `@kwtech/module-task/server` — everything a NestJS app needs.
 *
 * `@nestjs/common` and `@nestjs/graphql` are OPTIONAL peers: importing the
 * package root resolves nothing from here, so a consumer that only wants the
 * domain rules installs no framework.
 */

export * from './board.service.js';
export * from './graphql/task.resolver.js';
export * from './graphql/task.types.js';
export * from './ports.js';
export * from './server-module.js';
export * from './task.errors.js';
export * from './task.events.js';
export * from './task.lookup.js';
export * from './task.module.js';
export * from './task.options.js';
export * from './task.pubsub.js';
export * from './task.repository.js';
export * from './task.service.js';
export * from './task.tokens.js';
export * from './task-comment.service.js';
export * from './task-write.service.js';
