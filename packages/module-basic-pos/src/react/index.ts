/**
 * `@kwtech/module-basic-pos/react` — the web half.
 *
 * React and `@kwtech/web-ui` are optional peers. This entry point never imports
 * `/server`, so no server code reaches the browser bundle.
 */

export * from './module.js';
export * from './pos-app.js';
export * from './pos-client.js';
export * from './use-till.js';
