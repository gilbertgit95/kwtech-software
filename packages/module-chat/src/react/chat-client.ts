'use client';

import { CHAT_OPERATIONS } from '../operations.js';

/**
 * How chat's screens reach the API.
 *
 * ## Why the module cannot just call the API
 *
 * The browser has no route to it. `API_URL` is deliberately not `NEXT_PUBLIC_`
 * — publishing the API origin to every visitor is what the httpOnly-cookie
 * design exists to avoid — so every call goes through a route handler on the
 * app's own origin, which attaches the bearer token from the cookie.
 *
 * ## Why the path is a PARAMETER and not a constant
 *
 * That route handler belongs to `@kwtech/module-auth`, and these two modules
 * may not know about each other (PLAN §9). Hardcoding it here would be this
 * module naming the other one's URL — the same coupling the seam avoids,
 * smuggled in as a string instead of an import. So the default is the path this
 * app happens to mount, and any app that mounts it elsewhere passes its own.
 * Apps configure; modules do not guess.
 *
 * ⚠ The identical arrangement, and the identical default, as
 * `module-permissions`' client. Two modules agreeing on a default is not
 * coupling: neither reads the other's, and an app that moves the endpoint tells
 * both.
 */
export const DEFAULT_GRAPHQL_PATH = '/api/auth/graphql';

/** A participant as the screens read one. */
export interface ChatParticipantView {
  userId: string;
  displayName: string;
  /** 'invited' | 'active'. Nobody else is ever listed. */
  status: string;
}

/** One message, as the thread reads it. Mirrors `ChatMessageType`. */
export interface ChatMessageView {
  id: string;
  conversationId: string;
  /** 'user' | 'system'. A system message has no author and is drawn as a note. */
  kind: string;
  authorId: string | null;
  /** ⚠ NULL for a deleted message, always — the server never serves the body. */
  body: string | null;
  clientMessageId?: string | null;
  replyToMessageId: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
}

export interface ChatMessagePageView {
  items: ChatMessageView[];
  /** Ask for the next, OLDER page with this. Null at the beginning of history. */
  nextCursor: string | null;
}

/**
 * One person's presence, as somebody entitled to it is told.
 *
 * ⚠ `availability` is never 'invisible' and is null whenever there is nothing
 * to say: the publish boundary already decided, and a hidden person is
 * indistinguishable here from one who is genuinely away.
 */
export interface ChatPresenceView {
  userId: string;
  online: boolean;
  availability: string | null;
}

/** The viewer's OWN setting — the only one that may name `invisible`. */
export interface ChatMyAvailabilityView {
  availability: string;
  clearAt: string | null;
}

/** Somebody found by exact email. A miss and a block are the same answer. */
export interface ChatDirectoryMatchView {
  userId: string;
  displayName: string;
}

/** One conversation in the viewer's list. Mirrors `ChatConversationType`. */
export interface ChatConversationView {
  id: string;
  title: string | null;
  icon: string | null;
  isDirect: boolean;
  createdById: string;
  archived: boolean;
  lastMessageAt: string | null;
  /** The VIEWER's own standing: 'active' or 'invited'. */
  myStatus: string;
  /** Who is asking. The thread cannot tell your messages from anyone else's without it. */
  myUserId: string;
  unread: number;
  participants: ChatParticipantView[];
}

export interface ChatClient {
  listConversations(): Promise<ChatConversationView[]>;
  /**
   * A page of messages, NEWEST FIRST, by keyset.
   *
   * ⚠ `cursor` walks BACKWARDS through history — it is the oldest message the
   * caller already holds, and the page returned is the one before it. Offset
   * paging over an append-heavy list re-shows rows every time somebody posts
   * while you are scrolling.
   */
  listMessages(conversationId: string, cursor?: string | null): Promise<ChatMessagePageView>;
  send(input: {
    conversationId: string;
    body: string;
    clientMessageId: string;
    replyToMessageId?: string | null;
  }): Promise<ChatMessageView>;
  editMessage(messageId: string, body: string): Promise<ChatMessageView>;
  deleteMessage(messageId: string): Promise<ChatMessageView>;
  markRead(conversationId: string, messageId: string): Promise<void>;
  /** ⚠ EXACT EMAIL ONLY, and null covers both "no such account" and "blocked". */
  lookUp(email: string): Promise<ChatDirectoryMatchView | null>;
  startDirect(userId: string): Promise<ChatConversationView>;
  startGroup(title: string, userIds: readonly string[]): Promise<ChatConversationView>;
  invite(conversationId: string, userId: string): Promise<void>;
  /** ⚠ Groups only — a direct chat is named by who is in it, and the server refuses. */
  rename(conversationId: string, title: string): Promise<ChatConversationView>;
  /** ⚠ Answers only about people the viewer shares an active conversation with. */
  presenceOf(userIds: readonly string[]): Promise<ChatPresenceView[]>;
  myAvailability(): Promise<ChatMyAvailabilityView>;
  setAvailability(availability: string, forMinutes?: number | null): Promise<ChatMyAvailabilityView>;
  /** "I am writing." Throttled server-side; the indicator expires rather than stopping. */
  sendTyping(conversationId: string): Promise<void>;
  respondToInvitation(conversationId: string, accept: boolean): Promise<void>;
  leave(conversationId: string): Promise<void>;
}

export function createChatClient(options: { graphqlPath?: string } = {}): ChatClient {
  const path = options.graphqlPath ?? DEFAULT_GRAPHQL_PATH;

  /**
   * One request shape for every call.
   *
   * Throws on `errors` so each caller writes one happy path, and surfaces the
   * FIRST error's message rather than a generic one: the API's refusals are
   * already written for a reader, and replacing them with "Something went
   * wrong" throws away the only useful thing in the response.
   */
  async function graphql<T>(document: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // The session is an httpOnly cookie on this origin; without this the
      // request goes out unauthenticated and every call 401s.
      credentials: 'same-origin',
      body: JSON.stringify({ query: document, variables }),
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(response.status === 401 ? 'Your session has ended. Sign in again.' : 'Cannot reach the server.');
    }

    const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'The request was refused.');
    if (!body.data) throw new Error('The server returned no data.');
    return body.data;
  }

  return {
    async listConversations() {
      /*
       * Everything the viewer is in OR invited to, with the unread count
       * already computed per conversation — one grouped pass on the server, not
       * a count per row per render. See `ChatService.listConversations`.
       */
      const data = await graphql<{ chatConversations: ChatConversationView[] }>(CHAT_OPERATIONS.chatConversations);
      return data.chatConversations;
    },

    async listMessages(conversationId, cursor) {
      const data = await graphql<{ chatMessages: ChatMessagePageView }>(CHAT_OPERATIONS.chatMessages, {
        conversationId,
        cursor: cursor ?? null,
      });
      return data.chatMessages;
    },

    async send(input) {
      const data = await graphql<{ sendChatMessage: ChatMessageView }>(CHAT_OPERATIONS.sendChatMessage, {
        ...input,
        replyToMessageId: input.replyToMessageId ?? null,
      });
      /*
       * The server returns it now, so there is nothing to re-attach — and the
       * SUBSCRIPTION carries it too, which is what stops the sender seeing
       * their own message twice when the socket beats this response.
       */
      return data.sendChatMessage;
    },

    async editMessage(messageId, body) {
      const data = await graphql<{ editChatMessage: ChatMessageView }>(CHAT_OPERATIONS.editChatMessage, {
        messageId,
        body,
      });
      return data.editChatMessage;
    },

    async deleteMessage(messageId) {
      const data = await graphql<{ deleteChatMessage: ChatMessageView }>(CHAT_OPERATIONS.deleteChatMessage, {
        messageId,
      });
      return data.deleteChatMessage;
    },

    async markRead(conversationId, messageId) {
      await graphql(CHAT_OPERATIONS.markChatRead, { conversationId, messageId });
    },

    async lookUp(email) {
      const data = await graphql<{ chatDirectoryLookup: ChatDirectoryMatchView | null }>(
        CHAT_OPERATIONS.chatDirectoryLookup,
        { email },
      );
      return data.chatDirectoryLookup;
    },

    async startDirect(userId) {
      const data = await graphql<{ startDirectChat: ChatConversationView }>(CHAT_OPERATIONS.startDirectChat, {
        userId,
      });
      return data.startDirectChat;
    },

    async startGroup(title, userIds) {
      const data = await graphql<{ startGroupChat: ChatConversationView }>(CHAT_OPERATIONS.startGroupChat, {
        title,
        userIds: [...userIds],
      });
      return data.startGroupChat;
    },

    async rename(conversationId, title) {
      const data = await graphql<{ renameChat: ChatConversationView }>(CHAT_OPERATIONS.renameChat, {
        conversationId,
        title,
      });
      return data.renameChat;
    },

    async invite(conversationId, userId) {
      await graphql(CHAT_OPERATIONS.inviteToChat, { conversationId, userId });
    },

    async respondToInvitation(conversationId, accept) {
      await graphql(CHAT_OPERATIONS.respondToChatInvitation, { conversationId, accept });
    },

    async presenceOf(userIds) {
      if (userIds.length === 0) return [];
      const data = await graphql<{ chatPresence: ChatPresenceView[] }>(CHAT_OPERATIONS.chatPresence, {
        userIds: [...userIds],
      });
      return data.chatPresence;
    },

    async myAvailability() {
      const data = await graphql<{ chatMyAvailability: ChatMyAvailabilityView }>(CHAT_OPERATIONS.chatMyAvailability);
      return data.chatMyAvailability;
    },

    async setAvailability(availability, forMinutes) {
      const data = await graphql<{ setChatAvailability: ChatMyAvailabilityView }>(CHAT_OPERATIONS.setChatAvailability, {
        availability,
        forMinutes: forMinutes ?? null,
      });
      return data.setChatAvailability;
    },

    async sendTyping(conversationId) {
      await graphql(CHAT_OPERATIONS.sendChatTyping, { conversationId });
    },

    async leave(conversationId) {
      await graphql(CHAT_OPERATIONS.leaveChat, { conversationId });
    },
  };
}
