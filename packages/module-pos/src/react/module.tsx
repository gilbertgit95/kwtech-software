import type { WebModuleDescriptor } from '@kwtech/module-kit';
import { POS_FEATURE, POS_FEATURE_REGISTRY } from '../feature-keys.js';
import { PosApp } from './pos-app.js';

/**
 * The point-of-sale web descriptor — its app and its key, as data the web app composes:
 *
 *   const FEATURE_MODULES = [..., posWebModule()];
 *
 * A function, as `queueWebModule` is, so options can arrive without changing
 * the call site.
 *
 * ⚠ NO ROUTES and NO DRAWER ENTRY. A sub-app is reached from the workspace's
 * Apps page. A full-page route for direct links (a notification, a bookmark)
 * comes with the real screens, as the queue's console route did.
 */
export function posWebModule(): WebModuleDescriptor {
  return {
    key: 'pos',
    features: POS_FEATURE_REGISTRY,
    apps: [
      {
        // ⚠ Saved in people's layouts. Never rename it.
        key: 'pos',
        label: 'Point of sale',
        description: 'Ring up sales at the counter.',
        icon: 'store',
        feature: POS_FEATURE.read,
        // After the queue (10), notes (20) and tasks (30).
        order: 40,
        component: PosApp,
      },
    ],
  };
}
