/**
 * `@kwtech/module-basic-inventory/server` — everything a NestJS app needs.
 *
 * `@nestjs/common` and `@nestjs/graphql` are OPTIONAL peers: importing the
 * package root resolves nothing from here, so a consumer that only wants the
 * domain rules installs no framework.
 */

export * from './graphql/stock.resolver.js';
export * from './graphql/stock.types.js';
export * from './ports.js';
export * from './server-module.js';
export * from './stock.errors.js';
export * from './stock.events.js';
export * from './stock.lookup.js';
export * from './stock.module.js';
export * from './stock.options.js';
export * from './stock.pubsub.js';
export * from './stock.repository.js';
export * from './stock.tokens.js';
export * from './stock.views.js';
export * from './stock-catalogue.service.js';
export * from './stock-catch-up.process.js';
export * from './stock-directory.service.js';
export * from './stock-intake.service.js';
export * from './stock-move.service.js';
export * from './stock-take.service.js';
