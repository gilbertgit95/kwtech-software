import type { WebModuleDescriptor } from '@kwtech/module-kit';
import { STUDIO_FEATURE, STUDIO_FEATURE_REGISTRY, STUDIO_LIMIT_REGISTRY } from '../feature-keys.js';
import { StudioApp } from './studio-app.js';

/**
 * The print studio's web descriptor — its app, its keys and its cap, as data
 * the web app composes:
 *
 *   const FEATURE_MODULES = [..., studioWebModule()];
 *
 * A function, as `queueWebModule` is, so options can arrive without changing
 * the call site.
 *
 * ⚠ NO ROUTES and NO DRAWER ENTRY. A sub-app is reached from the workspace's
 * Apps page.
 */
export function studioWebModule(): WebModuleDescriptor {
  return {
    key: 'studio',
    features: STUDIO_FEATURE_REGISTRY,
    limits: STUDIO_LIMIT_REGISTRY,
    apps: [
      {
        // ⚠ Saved in people's layouts of the Apps page. Never rename it.
        key: 'studio',
        label: 'Print Studio',
        description: 'Lay photos out on paper at exact sizes, and print documents.',
        icon: 'printer',
        feature: STUDIO_FEATURE.read,
        // After booking, the last of the sub-apps so far.
        order: 70,
        component: StudioApp,
      },
    ],
  };
}
