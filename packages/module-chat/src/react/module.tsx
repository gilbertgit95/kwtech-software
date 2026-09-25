import type { ModuleRouteProps, WebModuleDescriptor } from '@kwtech/module-kit';
import { chatIsEnabled } from '../enabled.js';
import { CHAT_FEATURE, CHAT_FEATURE_REGISTRY, CHAT_LIMIT_REGISTRY } from '../feature-keys.js';
import { ChatUnreadBadge } from './chat-unread-badge.js';
import { ChatHeaderTool } from './components/chat-header-tool.js';
import { ChatPage } from './pages/chat-page.js';
import { ChatPreferencesPage } from './pages/chat-preferences-page.js';
import { ChatSettingsPage } from './pages/chat-settings-page.js';
import { CHAT_HREF, CHAT_PREFERENCES_HREF } from './routes.js';

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

/*
 * Re-exported so `@kwtech/module-chat/react`'s public surface is unchanged. The
 * declaration moved to `routes.ts` to break a cycle — see that file.
 */
export { CHAT_HREF, CHAT_PREFERENCES_HREF } from './routes.js';

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

function ChatRoute({ searchParams }: ModuleRouteProps) {
  /*
   * ⚠ RENDERED, never called — the reason this file is `.tsx`. `ChatPage` is a
   * client component, so across that boundary Next replaces it with a
   * client-reference proxy that can only be rendered; calling it throws.
   *
   * No props: the page builds its own client, and an app that wants to supply
   * one imports `ChatPage` directly rather than going through the route.
   */
  // `?conversation=` — where the floating window's "Open in full chat" points.
  // A repeated parameter is a malformed link, not a choice to make.
  const raw = searchParams?.conversation;
  return <ChatPage initialConversationId={typeof raw === 'string' && raw.length > 0 ? raw : undefined} />;
}

/**
 * The header tool, as a prop-less component — the only shape that crosses from
 * the app's server-rendered header into the client.
 */
function ChatHeaderToolSlot() {
  return <ChatHeaderTool />;
}

export interface ChatWebModuleOptions {
  /** ⚠ `false` contributes nothing at all — see `chatIsEnabled`. */
  enabled?: boolean;
  /**
   * Where the way into chat lives. ONE of the two, never both — two doors to one
   * place is how somebody learns to wonder which one is real (§12.52).
   *
   *   'header'  (default) an inbox button in the app header, with a panel of
   *             conversations and a floating, draggable window for one of them.
   *             `/chat` stays, unlisted, as the full page.
   *   'drawer'  the side drawer's 'Overview' group, with the unread badge on
   *             the entry — the arrangement before the header tool existed.
   */
  placement?: 'header' | 'drawer';
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

  const inHeader = (options.placement ?? 'header') === 'header';

  return {
    key: 'chat',
    features: CHAT_FEATURE_REGISTRY,
    limits: CHAT_LIMIT_REGISTRY,
    /*
     * Filtered by `chat:read`, the key every chat query checks — so the button
     * is absent for exactly the people the API would refuse. Order 10 leaves
     * room on both sides for the next tool.
     */
    ...(inHeader
      ? {
          headerTools: [
            { key: 'chat', label: 'Chat', order: 10, feature: CHAT_FEATURE.read, component: ChatHeaderToolSlot },
          ],
        }
      : {}),
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
         * ⚠ A DRAWER ENTRY ONLY WHEN THE HEADER TOOL IS OFF. The page itself
         * is always here; what moves is the door to it. With `placement:
         * 'header'` the inbox button is the way in and the route is unlisted;
         * with 'drawer' the entry carries the unread count instead. Never both
         * (§12.52, reversed for the header 2026-09-25).
         *
         * The count is a COMPONENT in either place, because a number resolved
         * on the server is right only until somebody else sends a message.
         */
        ...(inHeader ? {} : { nav: { group: 'Overview', order: 20, icon: 'message', badge: ChatUnreadBadge } }),
      },
      {
        /*
         * ⚠ UNLISTED, and `/chat/preferences` rather than `/chat/settings`.
         *
         * `/chat/:conversationId/settings` below means something else entirely
         * — what a GROUP is called and who runs it. Two pages a segment apart,
         * both called settings, one about a conversation and one about a
         * browser, is a collision people resolve by opening the wrong one.
         *
         * ⚠ It takes NO feature key beyond `chat:read`, and could arguably take
         * none at all: everything on it is stored in this browser and the page
         * makes no request. `chat:read` is here so it is not reachable by
         * somebody who cannot use chat — a preferences page for a feature you
         * do not have is a dead end with controls on it.
         */
        path: CHAT_PREFERENCES_HREF,
        component: ChatPreferencesPage,
        title: 'Chat preferences',
        feature: CHAT_FEATURE.read,
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
