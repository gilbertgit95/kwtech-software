import type { ModuleRouteProps, WebModuleDescriptor } from '@kwtech/module-kit';
import { QUEUE_FEATURE, QUEUE_FEATURE_REGISTRY, QUEUE_LIMIT_REGISTRY } from '../feature-keys.js';
import { QueueConsolePage } from './pages/queue-console-page.js';
import { QueueSettingsPage } from './pages/queue-settings-page.js';
import { QUEUE_CONSOLE_PATH, QUEUE_SETTINGS_PATH, WORKSPACE_NAV_GROUP } from './routes.js';

/**
 * The queue's web descriptor — its routes, its drawer entry and its
 * contributions, as data the app composes:
 *
 *   const WEB_MODULES = [authWebModule, permissionsWebModule, chatWebModule(), queueWebModule()];
 *
 * ⚠ `.tsx` because the route adapters RENDER their pages, never call them: the
 * pages are `'use client'`, and across that boundary Next replaces them with
 * client-reference proxies that can only be rendered.
 */

function QueueConsoleRoute({ params }: ModuleRouteProps) {
  return <QueueConsolePage params={params ?? {}} />;
}

function QueueSettingsRoute({ params }: ModuleRouteProps) {
  return <QueueSettingsPage params={params ?? {}} />;
}

export function queueWebModule(): WebModuleDescriptor {
  return {
    key: 'queue',
    features: QUEUE_FEATURE_REGISTRY,
    limits: QUEUE_LIMIT_REGISTRY,
    routes: [
      {
        path: QUEUE_CONSOLE_PATH,
        component: QueueConsoleRoute,
        title: 'Queue',
        /*
         * A WORKSPACE-level key under a workspace path, so the catch-all asks it
         * of this workspace — and a plan that does not sell the queue reads as
         * `not_entitled` here, before the page renders.
         */
        feature: QUEUE_FEATURE.read,
        // Between the workspace's Overview (10) and its Settings (20).
        nav: { group: WORKSPACE_NAV_GROUP, order: 15, icon: 'megaphone' },
      },
      {
        // UNLISTED — reached from the console. Each section inside checks its own key.
        path: QUEUE_SETTINGS_PATH,
        component: QueueSettingsRoute,
        title: 'Queue settings',
        feature: QUEUE_FEATURE.read,
      },
    ],
  };
}
