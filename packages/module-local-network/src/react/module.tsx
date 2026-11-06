import type { WebModuleDescriptor } from '@kwtech/module-kit';
import { localNetworkIsEnabled } from '../enabled.js';
import { LOCAL_NETWORK_FEATURE, LOCAL_NETWORK_FEATURE_REGISTRY } from '../feature-keys.js';
import { LocalNetworkPage } from './pages/local-network-page.js';
import { LOCAL_NETWORK_ADMIN_HREF } from './routes.js';

export { LOCAL_NETWORK_ADMIN_HREF } from './routes.js';

/**
 * The drawer's Server section, the one Backups declares (module-backup's
 * `SERVER_NAV_GROUP`, #76). ⚠ A shared STRING, not an import: modules never
 * import each other, so each declares 'Server' itself and its own
 * web-module test pins the literal. A typo here would split the drawer into
 * two Server sections.
 */
export const SERVER_NAV_GROUP = 'Server';

export interface LocalNetworkWebModuleOptions {
  /** The switch (`localNetworkIsEnabled`): on only for `true`. The app passes `NEXT_PUBLIC_LOCAL_NETWORK === 'on'`. */
  enabled?: boolean | undefined;
}

/**
 * Local Network's web descriptor: its page and its drawer entry, as data the
 * app composes.
 *
 * ⚠ THIS FILE IS `.tsx`, as every module's is: the route adapter must RENDER
 * its page, never call it, because across the `'use client'` boundary Next
 * hands the server a client reference that can only be rendered.
 */
export function localNetworkWebModule(options: LocalNetworkWebModuleOptions = {}): WebModuleDescriptor {
  if (!localNetworkIsEnabled(options)) {
    /*
     * ⚠ Off (the default, and every remote server): no page and no drawer
     * entry, but the KEY stays, as chat's does, so turning the page back on
     * finds the grants a super admin gave still there.
     */
    return { key: 'local_network', features: LOCAL_NETWORK_FEATURE_REGISTRY };
  }

  function LocalNetworkRoute() {
    return <LocalNetworkPage />;
  }

  return {
    key: 'local_network',
    features: LOCAL_NETWORK_FEATURE_REGISTRY,
    // The same order Backups gives the group (60, below Administration's 50), so whichever is composed first agrees.
    navGroups: [{ group: SERVER_NAV_GROUP, order: 60 }],
    routes: [
      {
        path: LOCAL_NETWORK_ADMIN_HREF,
        component: LocalNetworkRoute,
        title: 'Local Network',
        // `local_network:read`, the key the page's one query is bound to.
        feature: LOCAL_NETWORK_FEATURE.read,
        // After Backups (10).
        nav: { group: SERVER_NAV_GROUP, order: 20, icon: 'globe' },
      },
    ],
  };
}
