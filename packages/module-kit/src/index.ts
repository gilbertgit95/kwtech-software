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
 *
 * That holds for THIS entry point and is why it is worth keeping separate from
 * '@kwtech/module-kit/react', which is where the status channel's provider and
 * hooks live. The status VOCABULARY is here — levels, ordering, the store — so
 * it can be named and tested without a renderer; only the bindings need React.
 */

export * from './compose.js';
export * from './status.js';
export * from './status-store.js';
export * from './types.js';
