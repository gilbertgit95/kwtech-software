/**
 * `@kwtech/module-app-hub/react` — the Apps page and its descriptor.
 *
 * ⚠ Never imports `/server`: this entry point ships to the browser.
 */

export * from './app-hub-client.js';
export * from './module.js';
export { AppHubPage } from './pages/app-hub-page.js';
export * from './routes.js';
export type { AppHubEntry } from './types.js';
export * from './use-app-hub-layout.js';
