/**
 * `@kwtech/module-basic-bookkeeping/react` — the web half.
 *
 * React and `@kwtech/web-ui` are optional peers. This entry point never imports
 * `/server`, so no server code reaches the browser bundle.
 */

export * from './books-app.js';
export * from './books-client.js';
export * from './module.js';
export * from './use-books.js';
