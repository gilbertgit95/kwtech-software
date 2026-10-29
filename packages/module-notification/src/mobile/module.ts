import type { MobileModuleDescriptor } from '@kwtech/module-kit';
import { NOTIFICATION_FEATURE } from '../feature-keys.js';
import { InboxMobileBadge } from './inbox-mobile-badge.js';
import { InboxMobileView } from './inbox-mobile-view.js';

/**
 * What notifications offer the phone layout (issue #22): the Inbox, a
 * bottom-bar destination right of Chat, with the unread count on its icon.
 *
 * ⚠ Order 20: chat's tab is 10, as chat's header tool is 10 and the bell 20 —
 * this module does not know chat exists; the numbers are the arrangement.
 *
 * Filtered by `notification:read` at APP level, the key every inbox operation
 * is bound to, so the tab is absent for exactly the people the API refuses.
 */
export function notificationMobileModule(): MobileModuleDescriptor {
  return {
    key: 'notification',
    tabs: [
      {
        key: 'inbox',
        label: 'Inbox',
        icon: 'bell',
        feature: NOTIFICATION_FEATURE.read,
        order: 20,
        component: InboxMobileView,
        badge: InboxMobileBadge,
      },
    ],
  };
}
