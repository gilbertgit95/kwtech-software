import { composeNav, composeRoutes } from '@kwtech/module-kit';
import { QUEUE_FEATURE } from '../src/feature-keys.js';
import { queueWebModule } from '../src/react/module.js';
import {
  QUEUE_CONSOLE_PATH,
  QUEUE_DISPLAY_PATH,
  QUEUE_SETTINGS_PATH,
  WORKSPACE_NAV_GROUP,
} from '../src/react/routes.js';

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

  const params = { organizationId: 'org-1', workspaceId: 'ws-1' };

  it('lists the console alone, in the Workspace group, with the workspace filled into its link', () => {
    const entries = composeNav([module], [QUEUE_FEATURE.read], { params });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      group: 'Workspace',
      label: 'Queue',
      href: '/organizations/org-1/workspaces/ws-1/queue',
    });
  });

  it('lists nothing outside a workspace — there is no link to build', () => {
    // composeNav omits a route whose :params it cannot fill, rather than ship half a URL.
    expect(composeNav([module], [QUEUE_FEATURE.read])).toEqual([]);
  });

  it('lists nothing for somebody without queue:read', () => {
    expect(composeNav([module], [], { params })).toEqual([]);
  });

  it('⚠ spells the Workspace group exactly as module-permissions does, since it cannot import it', () => {
    expect(WORKSPACE_NAV_GROUP).toBe('Workspace');
  });

  it('carries its keys and caps, so an app composing descriptors sees them', () => {
    expect(module.features?.length).toBe(6);
    expect(module.limits?.length).toBe(2);
  });
});
