/**
 * @kwtech/module-permissions/server — everything a NestJS app needs.
 *
 * @nestjs/common, @nestjs/graphql and reflect-metadata are
 * optional peers: a browser bundle that never imports this subpath never pulls
 * them in.
 */

export * from './binding-index.js';
export * from './feature.guard.js';
export * from './graphql/permission.types.js';
export * from './graphql/permissions.resolver.js';
export * from './permissions.controller.js';
export * from './permissions.module.js';
export * from './permissions.pubsub.js';
export * from './permissions.repository.js';
export * from './permissions.service.js';
export * from './permissions-write.service.js';
export * from './registry-sync.js';
export * from './require-feature.decorator.js';
export * from './require-scope.decorator.js';
export * from './server-module.js';
