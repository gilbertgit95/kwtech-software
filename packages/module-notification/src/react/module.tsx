import type { WebModuleDescriptor } from '@kwtech/module-kit';
import { NOTIFICATION_FEATURE, NOTIFICATION_FEATURE_REGISTRY } from '../feature-keys.js';
import { NotificationHeaderTool } from './components/notification-header-tool.js';
import { AdminNotificationsPage } from './pages/admin-notifications-page.js';
import { NotificationPreferencesPage } from './pages/notification-preferences-page.js';
import { NotificationsPage } from './pages/notifications-page.js';
import { NOTIFICATION_PREFERENCES_HREF, NOTIFICATIONS_ADMIN_HREF, NOTIFICATIONS_HREF } from './routes.js';

/**
 * Notifications' web descriptor — the header tool, the three pages, and the
 * feature contributions, as data the app composes.
 *
 * ⚠ `.tsx` for the reason every module's descriptor is: a route adapter must
 * RENDER its page, never call it. The pages are `'use client'`, and across that
 * boundary Next replaces them with client-reference proxies that can only be
 * rendered.
 */

export { NOTIFICATION_PREFERENCES_HREF, NOTIFICATIONS_ADMIN_HREF, NOTIFICATIONS_HREF } from './routes.js';

/** The drawer group the admin page sits in. A shared NAME, pinned by `web-module.test.ts`. */
export const ADMINISTRATION_NAV_GROUP = 'Administration';

function NotificationsRoute() {
  return <NotificationsPage />;
}

function NotificationPreferencesRoute() {
  return <NotificationPreferencesPage />;
}

function AdminNotificationsRoute() {
  return <AdminNotificationsPage />;
}

/** The header tool, prop-less — the only shape that crosses from the server-rendered header. */
function NotificationHeaderToolSlot() {
  return <NotificationHeaderTool />;
}

export interface NotificationWebModuleOptions {
  /**
   * ⚠ `false` contributes the FEATURES and nothing else. Dropping the registry
   * would make the app's feature sync deprecate every `notification:*` row, and
   * a deprecated feature grants nothing — so switching off for a day would
   * quietly strip the key from every role. Disabling must be reversible by
   * flipping one flag back.
   */
  enabled?: boolean;
}

export function notificationWebModule(options: NotificationWebModuleOptions = {}): WebModuleDescriptor {
  if (options.enabled === false) return { key: 'notification', features: NOTIFICATION_FEATURE_REGISTRY };

  return {
    key: 'notification',
    features: NOTIFICATION_FEATURE_REGISTRY,
    /*
     * ⚠ Order 20: chat's inbox is 10, so the bell sits right of it. This module
     * does not know chat exists — the numbers are the whole arrangement, and
     * with chat off the bell is simply the only tool.
     *
     * Filtered by `notification:read`, the key every inbox operation is bound
     * to, so the bell is absent for exactly the people the API would refuse.
     */
    headerTools: [
      {
        key: 'notifications',
        label: 'Notifications',
        order: 20,
        feature: NOTIFICATION_FEATURE.read,
        component: NotificationHeaderToolSlot,
      },
    ],
    routes: [
      {
        /*
         * ⚠ UNLISTED — no `nav`. The bell is the one way in; a drawer entry too
         * would be two doors to one place.
         */
        path: NOTIFICATIONS_HREF,
        component: NotificationsRoute,
        title: 'Notifications',
        feature: NOTIFICATION_FEATURE.read,
      },
      {
        path: NOTIFICATION_PREFERENCES_HREF,
        component: NotificationPreferencesRoute,
        title: 'Notification settings',
        feature: NOTIFICATION_FEATURE.read,
      },
      {
        path: NOTIFICATIONS_ADMIN_HREF,
        component: AdminNotificationsRoute,
        title: 'Send notifications',
        feature: NOTIFICATION_FEATURE.send,
        nav: { group: ADMINISTRATION_NAV_GROUP, order: 40, icon: 'megaphone' },
      },
    ],
  };
}
