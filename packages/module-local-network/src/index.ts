/**
 * @kwtech/module-local-network — the pure core: the key, the switch, the
 * addresses, the page's words and the GraphQL document. Imports no framework
 * and no Node built-in, so the browser and the app's seed task can both read
 * it. From `@kwtech/*` it imports only `@kwtech/module-kit`.
 *
 *   import { LOCAL_NETWORK_FEATURE, localNetworkIsEnabled } from '@kwtech/module-local-network';
 *
 * The server half (`/server`) and the page (`/react`) come in phases 3 and 4
 * of #66 (docs/LOCAL-NETWORK-PLAN.md §9).
 */
export * from './domain/index.js';
export * from './enabled.js';
export * from './feature-keys.js';
export * from './operations.js';
export * from './types.js';
