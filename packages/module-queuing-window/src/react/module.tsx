import type { ModuleRouteProps, WebModuleDescriptor } from '@kwtech/module-kit';
import { QUEUE_FEATURE, QUEUE_FEATURE_REGISTRY, QUEUE_LIMIT_REGISTRY } from '../feature-keys.js';
import { QueueConsolePage } from './pages/queue-console-page.js';
import { QueueDisplayPage } from './pages/queue-display-page.js';
import { QueueSettingsPage } from './pages/queue-settings-page.js';
import { QueueApp } from './queue-app.js';
import { QUEUE_CONSOLE_PATH, QUEUE_DISPLAY_PATH, QUEUE_SETTINGS_PATH } from './routes.js';

/**
 * The queue's web descriptor — its routes, its app and its contributions, as
 * data the app composes:
 *
 *   const WEB_MODULES = [..., queueWebModule({ wsUrl: process.env.NEXT_PUBLIC_WS_URL })];
 *
 * ⚠ `.tsx` because the route adapters RENDER their pages, never call them: the
 * pages are `'use client'`, and across that boundary Next replaces them with
 * client-reference proxies that can only be rendered.
 */

export interface QueueWebModuleOptions {
  /**
   * The API's WebSocket URL, for the public display's OWN socket. Only the app
   * knows it. Absent, the board shows that live updates are not configured
   * rather than a board that silently never changes.
   */
  wsUrl?: string | undefined;
}

function QueueConsoleRoute({ params }: ModuleRouteProps) {
  return <QueueConsolePage params={params ?? {}} />;
}

function QueueSettingsRoute({ params }: ModuleRouteProps) {
  return <QueueSettingsPage params={params ?? {}} />;
}

export function queueWebModule(options: QueueWebModuleOptions = {}): WebModuleDescriptor {
  // A plain string crosses to the client page; a function would not (the adapter renders on the server).
  const wsUrl = options.wsUrl ?? null;
  function QueueDisplayRoute({ params }: ModuleRouteProps) {
    return <QueueDisplayPage params={params ?? {}} wsUrl={wsUrl} />;
  }

  return {
    key: 'queue',
    features: QUEUE_FEATURE_REGISTRY,
    limits: QUEUE_LIMIT_REGISTRY,
    /*
     * The queue on the workspace's Apps page, where it runs beside other apps in
     * tabs or a grid. `queue:read`, the console's own key, offers it; the
     * console's controls still check theirs.
     */
    apps: [
      {
        key: 'queue',
        label: 'Queue',
        description: 'Call numbers at your window and watch every window live.',
        icon: 'megaphone',
        feature: QUEUE_FEATURE.read,
        order: 10,
        component: QueueApp,
      },
    ],
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
        /*
         * ⚠ NO `nav`: a sub-app is reached from the workspace's Apps page, not
         * from the drawer (APP-HUB-PLAN decision 5). The route stays for direct
         * links — a notification, a bookmark — and renders the full page.
         */
      },
      {
        // UNLISTED — reached from the console. Each section inside checks its own key.
        path: QUEUE_SETTINGS_PATH,
        component: QueueSettingsRoute,
        title: 'Queue settings',
        feature: QUEUE_FEATURE.read,
      },
      {
        /*
         * ⚠ PUBLIC: no feature, no nav, and FULLSCREEN chrome. A TV in a waiting
         * room has no session; the display code is its authorisation, exchanged
         * over throttled HTTP. Keyed by organization and workspace KEY, because it
         * is typed on a TV remote.
         */
        path: QUEUE_DISPLAY_PATH,
        component: QueueDisplayRoute,
        title: 'Queue display',
        chrome: 'fullscreen',
      },
    ],
  };
}
