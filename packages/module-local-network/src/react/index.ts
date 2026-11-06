/**
 * `@kwtech/module-local-network/react` — the page, its client and hook, and
 * the web descriptor. May import React, `@kwtech/module-kit` and
 * `@kwtech/web-ui`; never `/server`, so no Node code reaches the browser.
 */
export * from './local-network-client.js';
export {
  LOCAL_NETWORK_ADMIN_HREF,
  type LocalNetworkWebModuleOptions,
  localNetworkWebModule,
  SERVER_NAV_GROUP,
} from './module.js';
export * from './pages/local-network-page.js';
export * from './use-local-network.js';
export * from './view/local-network-view.js';
