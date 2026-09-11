/**
 * `@kwtech/module-chat/react` — the web half.
 *
 * A SEPARATE entry point from '.', which stays framework-free: the domain rules
 * are importable by a Nest app, a worker or a test with no React anywhere near
 * them. That split is what lets `react` and `@kwtech/web-ui` be optional peers.
 *
 * ⚠ NAMED exports, never `export *`. Half of this barrel is `'use client'`, and
 * a client module is a proxy on the server rather than a real namespace — it
 * does not answer the enumeration `export *` compiles to, so the re-export
 * silently yields nothing.
 */

export {
  type ChatClient,
  type ChatConversationView,
  type ChatParticipantView,
  createChatClient,
  DEFAULT_GRAPHQL_PATH,
} from './chat-client.js';
export { ChatWidget, type ChatWidgetProps } from './chat-widget.js';
export { CHAT_HREF, type ChatWebModuleOptions, chatWebModule } from './module.js';
export { ChatPage } from './pages/chat-page.js';
export { CHAT_EVENTS, type ChatEventView } from './realtime-documents.js';
