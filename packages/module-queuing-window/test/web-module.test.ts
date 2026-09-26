import { composeApps, composeNav, composeRoutes } from '@kwtech/module-kit';
import { QUEUE_FEATURE } from '../src/feature-keys.js';
import { queueWebModule } from '../src/react/module.js';
import { QueueApp } from '../src/react/queue-app.js';
import { QUEUE_CONSOLE_PATH, QUEUE_DISPLAY_PATH, QUEUE_SETTINGS_PATH } from '../src/react/routes.js';

/** What adopting the queue on the web contributes. */
describe('queueWebModule', () => {
  const module = queueWebModule();

  it('contributes the console and its settings, both under a workspace path', () => {
    expect(composeRoutes([module]).map((route) => route.path)).toEqual([
      QUEUE_CONSOLE_PATH,
      QUEUE_SETTINGS_PATH,
      QUEUE_DISPLAY_PATH,
    ]);
    expect(QUEUE_CONSOLE_PATH).toBe('/organizations/:organizationId/workspaces/:workspaceId/queue');
  });

  it('⚠ gates the console and settings on queue:read — a WORKSPACE key, asked of the workspace in the URL', () => {
    const [consoleRoute, settingsRoute] = composeRoutes([module]);
    expect([consoleRoute?.feature, settingsRoute?.feature]).toEqual([QUEUE_FEATURE.read, QUEUE_FEATURE.read]);
  });

  it('⚠ makes the display PUBLIC and fullscreen: no key, no drawer entry, no frame', () => {
    const display = composeRoutes([module]).find((route) => route.path === QUEUE_DISPLAY_PATH);
    expect(display?.feature).toBeUndefined();
    expect(display?.nav).toBeUndefined();
    expect(display?.chrome).toBe('fullscreen');
    expect(QUEUE_DISPLAY_PATH).toBe('/queue-display/:organizationKey/:workspaceKey');
  });

  it('⚠ lists nothing in the drawer — a sub-app is reached from the Apps page (APP-HUB-PLAN decision 5)', () => {
    const params = { organizationId: 'org-1', workspaceId: 'ws-1' };
    expect(composeRoutes([module]).filter((route) => route.nav)).toEqual([]);
    expect(composeNav([module], [QUEUE_FEATURE.read], { params })).toEqual([]);
    expect(module.navGroups).toBeUndefined();
  });

  it('offers the queue on the Apps page, gated on queue:read, running the in-place app', () => {
    expect(composeApps([module])).toEqual([
      expect.objectContaining({ key: 'queue', label: 'Queue', feature: QUEUE_FEATURE.read, component: QueueApp }),
    ]);
  });

  it('⚠ keeps the app key stable — it is saved in people’s layouts', () => {
    expect(module.apps?.map((app) => app.key)).toEqual(['queue']);
  });

  it('carries its keys and caps, so an app composing descriptors sees them', () => {
    expect(module.features?.length).toBe(6);
    expect(module.limits?.length).toBe(2);
  });
});
