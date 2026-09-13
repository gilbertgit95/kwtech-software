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
  type ChatMyAvailabilityView,
  type ChatParticipantView,
  type ChatPresenceView,
  createChatClient,
  DEFAULT_GRAPHQL_PATH,
} from './chat-client.js';
export {
  CHAT_SETTINGS_STORAGE_KEY,
  CHAT_TONE_CHOICES,
  type ChatSettings,
  DEFAULT_CHAT_SETTINGS,
  readChatSettings,
  writeChatSettings,
} from './chat-settings.js';
export {
  CHAT_TONES,
  type ChatToneId,
  DEFAULT_CHAT_TONE,
  isChatToneId,
  playChatTone,
  unlockChatTones,
} from './chat-tone.js';
export { ChatUnreadBadge, type ChatUnreadBadgeProps } from './chat-unread-badge.js';
export { AvailabilityPicker } from './components/availability-picker.js';
export { ChatSubPage } from './components/chat-sub-page.js';
export { ConversationList } from './components/conversation-list.js';
export { MessageComposer } from './components/message-composer.js';
export { MessageThread } from './components/message-thread.js';
export { NewConversation } from './components/new-conversation.js';
export { PersonFinder } from './components/person-finder.js';
export { PresenceDot } from './components/presence-dot.js';
export { type ChatWebModuleOptions, chatWebModule } from './module.js';
export { ChatPage } from './pages/chat-page.js';
export { ChatPreferencesPage } from './pages/chat-preferences-page.js';
export { CHAT_EVENTS, type ChatEventView } from './realtime-documents.js';
export { CHAT_HREF, CHAT_PREFERENCES_HREF } from './routes.js';
export { type ChatState, type UseChatOptions, useChat } from './use-chat.js';
export { useConversationSettings } from './use-conversation-settings.js';
/*
 * The view RULES, which are pure and have no React in them. Exported because
 * they are the answer to "what is this conversation called" and "where does
 * this message go", and an app building its own chat screen needs the same
 * answers this one uses rather than a second opinion.
 */
export {
  conversationTitle,
  countWaiting,
  otherParticipants,
  type SplitConversations,
  splitConversations,
} from './view/conversation-view.js';
export {
  applyMessage,
  compareMessages,
  dropPending,
  isPending,
  optimisticMessage,
  type PendingMessage,
  readMarkFor,
  type ThreadMessage,
} from './view/message-view.js';
