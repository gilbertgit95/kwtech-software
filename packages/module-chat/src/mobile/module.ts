import type { MobileModuleDescriptor } from '@kwtech/module-kit';
import { CHAT_FEATURE } from '../feature-keys.js';
import { ChatUnreadBadge } from '../react/chat-unread-badge.js';
import { ChatMobileView } from './chat-mobile-view.js';

/**
 * What chat offers the phone layout (issue #22): one bottom-bar destination,
 * Chat, with the live unread count on its icon.
 *
 * Filtered by `chat:read` at APP level — the key every chat query checks, and
 * the one the desktop header tool is filtered by — so the tab is absent for
 * exactly the people the API would refuse.
 *
 * ⚠ The components are rendered with NO props, as a header tool's are: they
 * cross from the server page. Each builds its own client.
 */
export function chatMobileModule(): MobileModuleDescriptor {
  return {
    key: 'chat',
    tabs: [
      {
        key: 'chat',
        label: 'Chat',
        icon: 'message',
        feature: CHAT_FEATURE.read,
        order: 10,
        component: ChatMobileView,
        // Live, and nothing at all at zero — the same count the drawer and header show.
        badge: ChatUnreadBadge,
      },
    ],
  };
}
