import type { ModuleRouteProps, WebModuleDescriptor } from '@kwtech/module-kit';
import { chatIsEnabled } from '../enabled.js';
import { CHAT_FEATURE, CHAT_FEATURE_REGISTRY, CHAT_LIMIT_REGISTRY } from '../feature-keys.js';
import { ChatUnreadBadge } from './chat-unread-badge.js';
import { ChatPage } from './pages/chat-page.js';
import { ChatSettingsPage } from './pages/chat-settings-page.js';

/**
 * Chat's web descriptor — the route, its drawer entry and the feature
 * contributions, as data the app composes.
 *
 *   const WEB_MODULES = [authWebModule, permissionsWebModule, chatWebModule()];
 *
 * ⚠ A FUNCTION where the other two are constants, and the reason is the switch:
 * `chatWebModule({ enabled: false })` returns a descriptor that contributes
 * NOTHING — no route, no nav entry, no badge — and it reads that flag through
 * the same `chatIsEnabled` the Nest module does, so the two halves of the
 * module cannot disagree about what "on" means.
 *
 * ⚠ THIS FILE IS `.tsx` FOR THE SAME REASON THE OTHER MODULES' ARE. The route
 * adapter must RENDER its page, never call it: the pages are `'use client'`,
 * and across that boundary Next replaces the module with a client-reference
 * proxy that can only be rendered. Calling one throws "Attempted to call
 * ChatPage() from the server".
 */

/** Where chat's own pages live. One constant, so the route and every link to it agree. */
export const CHAT_HREF = '/chat';

/**
 * One conversation's settings.
 *
 * ⚠ A FUNCTION, because the path has a `:conversationId` in it and a link needs
 * the filled one. Written here rather than at each call site so the route and
 * every link to it cannot disagree about the shape.
 */
export function chatSettingsHref(conversationId: string): string {
  return `${CHAT_HREF}/${encodeURIComponent(conversationId)}/settings`;
}

function ChatSettingsRoute({ params }: ModuleRouteProps) {
  // ⚠ Rendered, never called — see `ChatRoute`. `params` carries what the
  // route's `:conversationId` captured; module-kit matched it, because Next
  // sees only the catch-all.
  return <ChatSettingsPage params={params ?? {}} />;
}

function ChatRoute() {
  /*
   * ⚠ RENDERED, never called — the reason this file is `.tsx`. `ChatPage` is a
   * client component, so across that boundary Next replaces it with a
   * client-reference proxy that can only be rendered; calling it throws.
   *
   * No props: the page builds its own client, and an app that wants to supply
   * one imports `ChatPage` directly rather than going through the route.
   */
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
         * The same key the API enforces on every chat query, and the only one
         * involved: the badge below hangs off this entry, so it is filtered by
         * this key too and there is no second one to keep in step. ⚠ The filter
         * is an ergonomic: `/chat` typed into the address bar is refused by the
         * catch-all, and the GraphQL endpoint refuses it again regardless.
         * Hiding is not enforcing.
         */
        feature: CHAT_FEATURE.read,
        /*
         * ⚠ THE COUNT HANGS OFF THE DRAWER ENTRY, and there is no icon in the
         * app's main header.
         *
         * The first design put it there — a header slot left of the account
         * menu — and that was a second door to a place the drawer already
         * leads. Two controls for one destination is how a person learns to
         * wonder which one is the real one, and the drawer is where this
         * application says where you can go. Reversed 2026-09-11.
         *
         * The badge is still a COMPONENT rather than a number, because the
         * reason it existed has not changed: a count resolved on the server is
         * right until somebody else sends a message.
         */
        nav: { group: 'Overview', order: 20, icon: 'message', badge: ChatUnreadBadge },
      },
      {
        /*
         * ⚠ UNLISTED — no `nav` at all, which is what `ModuleRoute` means by
         * "reachable but not in the drawer". A settings page for one
         * conversation has nothing to offer somebody who has not opened that
         * conversation, and the drawer is for places rather than for things.
         * Reached from the thread's own header, exactly as the permissions
         * module's write screens are.
         */
        path: `${CHAT_HREF}/:conversationId/settings`,
        component: ChatSettingsRoute,
        title: 'Conversation settings',
        /*
         * ⚠ `chat:read` AND NOTHING NARROWER. Which controls appear is decided
         * by the participant's ROLE, inside the page and again at the API —
         * a key here would be a third answer to a question two places already
         * answer, and the one that drifted would be this one.
         */
        feature: CHAT_FEATURE.read,
      },
    ],
  };
}
