import type { AppContribution, ModuleRouteProps, WebModuleDescriptor } from '@kwtech/module-kit';
import { APP_HUB_FEATURE, APP_HUB_FEATURE_REGISTRY } from '../feature-keys.js';
import { AppHubPage } from './pages/app-hub-page.js';
import { APP_HUB_PATH, WORKSPACE_NAV_GROUP } from './routes.js';
import type { AppHubEntry } from './types.js';

/**
 * The Apps page's web descriptor. The app hands it every OTHER module's apps:
 *
 *   const APPS = composeApps(SUB_APP_MODULES);
 *   const WEB_MODULES = [..., ...SUB_APP_MODULES, appHubWebModule({ apps: APPS })];
 *
 * so this module lists the queue, and every sub-app after it, without
 * importing one (PLAN §9 rule 5).
 *
 * ⚠ `.tsx` because the route adapter RENDERS: the page is `'use client'`, and
 * the adapter runs on the server, where a component function cannot be passed
 * to it as a prop. So each app is rendered HERE, into an element for this
 * workspace, and the page receives elements — which do cross.
 */
export interface AppHubWebModuleOptions {
  /** Every sub-app, from `composeApps`. Empty means the page says there are none. */
  apps: readonly AppContribution[];
}

export function appHubWebModule(options: AppHubWebModuleOptions): WebModuleDescriptor {
  const apps = options.apps;

  function AppHubRoute({ params }: ModuleRouteProps) {
    const organizationId = params?.organizationId ?? '';
    const workspaceId = params?.workspaceId ?? '';
    const entries: AppHubEntry[] = apps.map((app) => {
      const App = app.component;
      return {
        key: app.key,
        label: app.label,
        description: app.description ?? null,
        icon: app.icon ?? null,
        feature: app.feature,
        element: <App organizationId={organizationId} workspaceId={workspaceId} />,
      };
    });
    return <AppHubPage organizationId={organizationId} workspaceId={workspaceId} apps={entries} />;
  }

  return {
    key: 'app_hub',
    features: APP_HUB_FEATURE_REGISTRY,
    routes: [
      {
        path: APP_HUB_PATH,
        component: AppHubRoute,
        title: 'Apps',
        /*
         * A WORKSPACE-level key under a workspace path, so the catch-all asks it
         * of this workspace. Every plan carries it (the page is free), so a
         * refusal here means a role that lacks it, and says so.
         */
        feature: APP_HUB_FEATURE.read,
        // After Overview (10), before Members (20): the page people open daily sits near the top.
        nav: { group: WORKSPACE_NAV_GROUP, order: 15, icon: 'blocks' },
      },
    ],
  };
}
