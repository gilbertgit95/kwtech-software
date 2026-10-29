import { chatMobileModule } from '@kwtech/module-chat/mobile';
import {
  composeMobileManage,
  composeMobileScreens,
  composeMobileTabs,
  type MobileModuleDescriptor,
} from '@kwtech/module-kit';
import { notificationMobileModule } from '@kwtech/module-notification/mobile';

/**
 * Every module the PHONE layout composes, listed once (issue #22).
 *
 * Separate from `WEB_MODULES`, and that separation is the point: the phone
 * page imports this list and never that one, so a phone downloads none of the
 * desktop pages. A module joins by exporting `xMobileModule()` from its
 * `/mobile` subpath and adding one line here — see the module-kit README,
 * "Mobile screens". Which modules join is chosen one at a time; a module not
 * listed is not on phones, and its pages say so with a way to the full site.
 *
 * Chat and the notification Inbox are on the bottom bar. No workspace app or
 * Manage page yet: each follows in its own change.
 */
export const MOBILE_MODULES: readonly MobileModuleDescriptor[] = [
  // Chat, then the Inbox right of it: chat's tab is order 10, the inbox 20.
  chatMobileModule(),
  notificationMobileModule(),
];

/** In tab order. `composeMobileScreens` throws on a duplicate key, at import rather than at first request. */
export const MOBILE_SCREENS = composeMobileScreens(MOBILE_MODULES);

/** Nearest level first, then by `order`. Throws on a duplicate key, at import. */
export const MOBILE_MANAGE = composeMobileManage(MOBILE_MODULES);

/** Left to right, between Apps and Manage. Throws on a duplicate key, or one of the frame's own names. */
export const MOBILE_TABS = composeMobileTabs(MOBILE_MODULES);
