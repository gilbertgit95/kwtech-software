import type { WebModuleDescriptor } from '@kwtech/module-kit';
import { chatIsEnabled } from '../enabled.js';
import { CHAT_FEATURE, CHAT_FEATURE_REGISTRY, CHAT_LIMIT_REGISTRY } from '../feature-keys.js';
import { ChatWidget } from './chat-widget.js';
import { ChatPage } from './pages/chat-page.js';

/**
 * Chat's web descriptor — the route, the header control and the feature
 * contributions, as data the app composes.
 *
 *   const WEB_MODULES = [authWebModule, permissionsWebModule, chatWebModule()];
 *
 * ⚠ A FUNCTION where the other two are constants, and the reason is the switch:
 * `chatWebModule({ enabled: false })` returns a descriptor that contributes
 * NOTHING — no route, no nav entry, no header slot — and it reads that flag
 * through the same `chatIsEnabled` the Nest module does, so the two halves of
 * the module cannot disagree about what "on" means.
 *
 * ⚠ THIS FILE IS `.tsx` FOR THE SAME REASON THE OTHER MODULES' ARE. The route
 * adapter must RENDER its page, never call it: the pages are `'use client'`,
 * and across that boundary Next replaces the module with a client-reference
 * proxy that can only be rendered. Calling one throws "Attempted to call
 * ChatPage() from the server".
 */

/** Where chat's own pages live. One constant, so the route and the icon agree. */
export const CHAT_HREF = '/chat';

function ChatRoute() {
  return <ChatPage />;
}

export interface ChatWebModuleOptions {
  /** ⚠ `false` contributes nothing at all — see `chatIsEnabled`. */
  enabled?: boolean;
}

export function chatWebModule(options: ChatWebModuleOptions = {}): WebModuleDescriptor {
  if (!chatIsEnabled(options)) {
    /*
     * ⚠ The FEATURES stay, and everything else goes. Dropping the registry here
     * would make the host's feature sync deprecate every `chat:*` row, and a
     * deprecated feature grants nothing — so a temporary disable would quietly
     * strip chat rights from every role that holds them. Disabling must be
     * reversible by flipping one flag back.
     */
    return { key: 'chat', features: CHAT_FEATURE_REGISTRY, limits: CHAT_LIMIT_REGISTRY };
  }

  return {
    key: 'chat',
    features: CHAT_FEATURE_REGISTRY,
    limits: CHAT_LIMIT_REGISTRY,
    /*
     * ⚠ NOT IN 'Administration', and not in a group of its own either.
     *
     * Chat is a thing everybody with the key does, not a section of the back
     * office, so it belongs in the app's own top group beside the dashboard.
     * A module cannot name another module's group placement, so this declares
     * only its entry and leaves 'Overview' where the app put it — if the app
     * has no such group, `navGroupRank` sorts it last, which is visible and
     * harmless.
     */
    routes: [
      {
        path: CHAT_HREF,
        component: ChatRoute,
        title: 'Chat',
        /*
         * The same key the API enforces on every chat query, and the same one
         * the header slot below is filtered by. ⚠ The filter is an ergonomic:
         * `/chat` typed into the address bar is refused by the catch-all, and
         * the GraphQL endpoint refuses it again regardless. Hiding is not
         * enforcing.
         */
        feature: CHAT_FEATURE.read,
        nav: { group: 'Overview', order: 20, icon: 'message' },
      },
    ],
    /*
     * ⚠ THE ICON IN THE HEADER, contributed rather than wired.
     *
     * It hangs left of the account menu — the right-hand cluster is things
     * about YOU, and a notification bell will join the same cluster later. An
     * icon hardcoded into the app's `header.tsx` would be unfiltered by
     * `chat:read`, absent from this descriptor, and would teach the app shell
     * what chat is.
     *
     * ⚠ A COMPONENT REFERENCE, never a function prop: the composing layer is a
     * server component, and a function cannot cross that boundary.
     *
     * 50 leaves room on both sides — a bell at 40, something at 60 — without
     * anybody renumbering this one.
     */
    headerSlots: [{ key: 'chat', Component: ChatWidget, order: 50, feature: CHAT_FEATURE.read }],
  };
}
