'use client';

/**
 * The document chat subscribes to.
 *
 * A document is a STRING, and it lives in a file of its own so that naming one
 * costs nothing: a component that says which events it cares about must not
 * resolve a WebSocket client to do it. The connection itself belongs to the
 * APP — `@kwtech/module-kit/realtime`, opened once per tab — and this module
 * only ever reads it through `useRealtime()`.
 *
 * Not in a `.graphql` file either: that shape is for an app's CODEGEN, and this
 * is sent as a string by the hand-rolled client beside it.
 */

/**
 * ONE subscription for everything that happens to this person.
 *
 * ⚠ `since` IS WHAT STOPS RECONNECTION LOSING MAIL. The socket closes when its
 * authorization expires, by design, and the server's pub/sub has no replay — so
 * a message published in the gap is gone rather than late unless the client says
 * where it left off. A caller that holds a message cursor passes it; one that
 * does not passes null and gets the `sync` event alone, which tells it to
 * re-read.
 *
 * ⚠ `kind` is the discriminator: 'sync' | 'message' | 'conversation'. A `sync`
 * carries nothing at all and arrives FIRST on every connection and every
 * reconnection — an invitation, a removal, a rename and an archive have no rows
 * to replay, and one "re-read your list" covers all four.
 */
export const CHAT_EVENTS = `subscription ChatEvents($since: String) {
  chatEvents(since: $since) {
    kind
    conversationId
    change
    message {
      id
      conversationId
      kind
      authorId
      body
      replyToMessageId
      createdAt
      editedAt
      deleted
    }
  }
}`;

/** One event as it arrives on the socket. Mirrors `ChatEventType`. */
export interface ChatEventView {
  kind: string;
  conversationId: string | null;
  change: string | null;
  message: {
    id: string;
    conversationId: string;
    kind: string;
    authorId: string | null;
    body: string | null;
    replyToMessageId: string | null;
    createdAt: string;
    editedAt: string | null;
    deleted: boolean;
  } | null;
}
