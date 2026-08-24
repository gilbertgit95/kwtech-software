/**
 * @kwtech/module-kit — how an app assembles N feature modules.
 *
 * A module-* package exports descriptors; an app lists them once:
 *
 *   export const WEB_MODULES = [permissionsWebModule, usersWebModule];
 *   export const ROUTES = composeRoutes(WEB_MODULES);
 *
 * and its navigation, middleware, catch-all route and seed registry all derive
 * from that one list. Adding the tenth module is the same edit as the second.
 *
 * Depends on nothing at runtime: react is type-only and optional, and Nest
 * modules are carried as opaque values so this package never imports Nest.
 */
export * from './types.js';
export * from './compose.js';
