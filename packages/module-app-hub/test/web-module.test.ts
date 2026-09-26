import { type AppContribution, composeNav, composeRoutes, type ModuleRouteProps } from '@kwtech/module-kit';
import { isValidElement } from 'react';
import { APP_HUB_FEATURE } from '../src/feature-keys.js';
import { appHubWebModule } from '../src/react/module.js';
import { APP_HUB_PATH, appHubHref, WORKSPACE_NAV_GROUP } from '../src/react/routes.js';

/** What adopting the Apps page on the web contributes. */
describe('appHubWebModule', () => {
  const Queue = () => null;
  const apps: AppContribution[] = [
    { key: 'queue', label: 'Queue', feature: 'queue:read', icon: 'megaphone', order: 10, component: Queue },
  ];
  const module = appHubWebModule({ apps });
  const params = { organizationId: 'org-1', workspaceId: 'ws-1' };

  it('contributes one route, under a workspace path, gated on app_hub:read', () => {
    const routes = composeRoutes([module]);
    expect(routes.map((route) => [route.path, route.feature])).toEqual([[APP_HUB_PATH, APP_HUB_FEATURE.read]]);
    expect(APP_HUB_PATH).toBe('/organizations/:organizationId/workspaces/:workspaceId/apps');
  });

  it('lists Apps in the Workspace section, after Overview (10) and before Members (20)', () => {
    const [entry] = composeNav([module], [APP_HUB_FEATURE.read], { params });
    expect(entry).toMatchObject({ group: 'Workspace', order: 15, label: 'Apps', href: appHubHref('org-1', 'ws-1') });
  });

  it('⚠ spells the Workspace group exactly as module-permissions does, since it cannot import it', () => {
    expect(WORKSPACE_NAV_GROUP).toBe('Workspace');
  });

  it('lists nothing outside a workspace, or for somebody without the key', () => {
    expect(composeNav([module], [APP_HUB_FEATURE.read])).toEqual([]);
    expect(composeNav([module], [], { params })).toEqual([]);
  });

  it('⚠ renders each app into an element for the workspace in the URL — a component could not cross to the page', () => {
    // A function component — `appHubWebModule` declares it as one; the type admits classes too.
    const Route = composeRoutes([module])[0]?.component as ((props: ModuleRouteProps) => unknown) | undefined;
    const page = Route?.({ params }) as { props: { apps: { key: string; element: unknown }[] } } | undefined;
    const [queue] = page?.props.apps ?? [];
    expect(queue?.key).toBe('queue');
    expect(isValidElement(queue?.element)).toBe(true);
    expect((queue?.element as { props: unknown } | undefined)?.props).toEqual(params);
  });

  it('carries its keys, so the app composing descriptors sees them', () => {
    expect(module.features?.map((spec) => spec.key)).toEqual([APP_HUB_FEATURE.read, APP_HUB_FEATURE.layoutManage]);
  });
});
