/**
 * @kwtech/module-permissions/react — the browser adapter.
 *
 * react is an optional peer, so a server app importing only the core or the
 * nest subpath never pulls it in.
 */

export * from './feature-gate.js';
export * from './module.js';
export * from './pages/roles-page.js';
export * from './permissions-provider.js';
export * from './use-permissions.js';
