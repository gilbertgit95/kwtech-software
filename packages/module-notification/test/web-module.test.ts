import { composeHeaderTools, composeNav, composeRoutes } from '@kwtech/module-kit';
import { NOTIFICATION_FEATURE } from '../src/feature-keys.js';
import { ADMINISTRATION_NAV_GROUP, notificationWebModule } from '../src/react/module.js';
import { NOTIFICATION_PREFERENCES_HREF, NOTIFICATIONS_ADMIN_HREF, NOTIFICATIONS_HREF } from '../src/react/routes.js';

describe('notificationWebModule', () => {
  const module = notificationWebModule();

  it('contributes the inbox, its settings, and the admin page — all app level, none under a tenant', () => {
    const paths = composeRoutes([module]).map((route) => route.path);
    expect(paths).toEqual([NOTIFICATIONS_HREF, NOTIFICATION_PREFERENCES_HREF, NOTIFICATIONS_ADMIN_HREF]);
    for (const path of paths) expect(path.startsWith('/organizations')).toBe(false);
  });

  it('⚠ puts the bell in the header at order 20 — right of chat (10), knowing nothing about chat', () => {
    const [tool] = composeHeaderTools([module], [NOTIFICATION_FEATURE.read]);
    expect(tool).toMatchObject({ key: 'notifications', order: 20, feature: NOTIFICATION_FEATURE.read });
  });

  it('hides the bell from somebody without notification:read', () => {
    expect(composeHeaderTools([module], [])).toEqual([]);
  });

  it('⚠ lists NO drawer entry for the inbox — the bell is the one way in', () => {
    const inbox = composeRoutes([module]).filter((route) => route.path.startsWith(NOTIFICATIONS_HREF));
    expect(inbox.map((route) => route.nav)).toEqual([undefined, undefined]);
  });

  it('lists the admin page in Administration, for notification:send only', () => {
    expect(composeNav([module], [NOTIFICATION_FEATURE.read])).toEqual([]);
    expect(composeNav([module], [NOTIFICATION_FEATURE.send])).toEqual([
      expect.objectContaining({ group: ADMINISTRATION_NAV_GROUP, href: NOTIFICATIONS_ADMIN_HREF }),
    ]);
    expect(ADMINISTRATION_NAV_GROUP).toBe('Administration');
  });

  it('gates every route on a key', () => {
    expect(composeRoutes([module]).every((route) => route.feature)).toBe(true);
  });

  it('⚠ keeps its keys when disabled, so a feature sync does not strip them from every role', () => {
    const disabled = notificationWebModule({ enabled: false });
    expect(disabled.features?.length).toBe(module.features?.length);
    expect(disabled.routes).toBeUndefined();
    expect(disabled.headerTools).toBeUndefined();
  });
});
