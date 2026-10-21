/**
 * `@kwtech/module-basic-inventory/react` — the web half.
 *
 * React and `@kwtech/web-ui` are optional peers. This entry point never imports
 * `/server`, so no server code reaches the browser bundle.
 */

export * from './module.js';
export * from './stock-app.js';
export * from './stock-client.js';
export * from './use-stock.js';
