/**
 * Every GraphQL document this module sends, as data.
 *
 * ## Why they are here rather than inline in the client that sends them
 *
 * Because a document is the ONE part of a typed client that nothing typechecks.
 * A wrong field name, a renamed argument, a nullability that moved — none of it
 * is a compile error anywhere; it is a runtime refusal on a screen, discovered
 * by whoever opens that screen first. Lifting them out means the host can hand
 * every one of them to `graphql`'s own validator against the schema it actually
 * serves, which is what `apps/web-server/test/chat-operations.test.ts` does.
 *
 * ⚠ FRAMEWORK-FREE, and exported from the package ROOT rather than from
 * `/react`. A server validating them must not have to resolve React to read a
 * string. That is the same split the domain rules already live under.
 *
 * They are sent as strings by a hand-rolled client rather than being fed to an
 * app's codegen — the arrangement `module-permissions` already uses. An app
 * that prefers generated hooks has the documents right here to generate from.
 */

/**
 * ⚠ `myUserId` IS LOAD-BEARING, not a convenience. Every message carries an
 * `authorId` and nothing else says which of them is yours, so without it a
 * thread cannot align its own messages or know which it may edit.
 */
const CONVERSATION_FIELDS = `
  id
  title
  icon
  isDirect
  createdById
  archived
  lastMessageAt
  myStatus
  myUserId
  unread
  participants { userId displayName status role }
`;

/**
 * ⚠ `clientMessageId` IS ASKED FOR EVERYWHERE, including on the subscription.
 *
 * It was left out on the grounds that it is the sender's own idea rather than
 * the server's, and that was a bug rather than a principle: the sender draws
 * their message optimistically and reconciles the real one against that draft
 * by this value, so an event without it is appended BESIDE the draft and the
 * sender sees their own message twice. Fixed 2026-09-12.
 */
const MESSAGE_FIELDS = `
  id
  conversationId
  kind
  authorId
  body
  clientMessageId
  replyToMessageId
  createdAt
  editedAt
  deleted
`;

export const CHAT_OPERATIONS = {
  chatConversations: `query ChatConversations { chatConversations { ${CONVERSATION_FIELDS} } }`,

  chatMessages: `query ChatMessages($conversationId: String!, $cursor: String) {
    chatMessages(conversationId: $conversationId, cursor: $cursor) {
      nextCursor
      items { ${MESSAGE_FIELDS} }
    }
  }`,

  chatDirectoryLookup: `query ChatDirectoryLookup($email: String!) {
    chatDirectoryLookup(email: $email) { userId displayName }
  }`,

  sendChatMessage: `mutation SendChatMessage(
    $conversationId: String!
    $body: String!
    $clientMessageId: String
    $replyToMessageId: String
  ) {
    sendChatMessage(
      conversationId: $conversationId
      body: $body
      clientMessageId: $clientMessageId
      replyToMessageId: $replyToMessageId
    ) { ${MESSAGE_FIELDS} }
  }`,

  editChatMessage: `mutation EditChatMessage($messageId: String!, $body: String!) {
    editChatMessage(messageId: $messageId, body: $body) { ${MESSAGE_FIELDS} }
  }`,

  deleteChatMessage: `mutation DeleteChatMessage($messageId: String!) {
    deleteChatMessage(messageId: $messageId) { ${MESSAGE_FIELDS} }
  }`,

  markChatRead: `mutation MarkChatRead($conversationId: String!, $messageId: String!) {
    markChatRead(conversationId: $conversationId, messageId: $messageId)
  }`,

  startDirectChat: `mutation StartDirectChat($userId: String!) {
    startDirectChat(userId: $userId) { ${CONVERSATION_FIELDS} }
  }`,

  startGroupChat: `mutation StartGroupChat($title: String!, $userIds: [String!]!) {
    startGroupChat(title: $title, userIds: $userIds) { ${CONVERSATION_FIELDS} }
  }`,

  /**
   * Rename a group.
   *
   * ⚠ `$icon` IS NOT DECLARED, and that is the whole correctness of this
   * document. The resolver distinguishes an ABSENT argument from a null one —
   * absent leaves the icon alone, null CLEARS it — so a document that declared
   * `$icon` and sent nothing for it would silently wipe the icon of every group
   * anybody renamed. Renaming is not the icon's business.
   */
  renameChat: `mutation RenameChat($conversationId: String!, $title: String!) {
    renameChat(conversationId: $conversationId, title: $title) { ${CONVERSATION_FIELDS} }
  }`,

  setChatParticipantRole: `mutation SetChatParticipantRole($conversationId: String!, $userId: String!, $role: String!) {
    setChatParticipantRole(conversationId: $conversationId, userId: $userId, role: $role)
  }`,

  removeChatParticipant: `mutation RemoveChatParticipant($conversationId: String!, $userId: String!) {
    removeChatParticipant(conversationId: $conversationId, userId: $userId)
  }`,

  setChatArchived: `mutation SetChatArchived($conversationId: String!, $archived: Boolean!) {
    setChatArchived(conversationId: $conversationId, archived: $archived)
  }`,

  inviteToChat: `mutation InviteToChat($conversationId: String!, $userId: String!) {
    inviteToChat(conversationId: $conversationId, userId: $userId)
  }`,

  respondToChatInvitation: `mutation RespondToChatInvitation($conversationId: String!, $accept: Boolean!) {
    respondToChatInvitation(conversationId: $conversationId, accept: $accept)
  }`,

  leaveChat: `mutation LeaveChat($conversationId: String!) {
    leaveChat(conversationId: $conversationId)
  }`,

  chatPresence: `query ChatPresence($userIds: [String!]!) {
    chatPresence(userIds: $userIds) { userId online availability }
  }`,

  chatMyAvailability: `query ChatMyAvailability {
    chatMyAvailability { availability clearAt }
  }`,

  setChatAvailability: `mutation SetChatAvailability($availability: String!, $forMinutes: Int) {
    setChatAvailability(availability: $availability, forMinutes: $forMinutes) { availability clearAt }
  }`,

  sendChatTyping: `mutation SendChatTyping($conversationId: String!) {
    sendChatTyping(conversationId: $conversationId)
  }`,

  /**
   * ⚠ THE SUBSCRIPTION, and `since` is what stops a reconnection losing mail.
   *
   * The socket closes when its authorization expires, by design, and the
   * server's pub/sub has no replay — so a message published in that gap is gone
   * rather than late unless the client says where it left off.
   */
  chatEvents: `subscription ChatEvents($since: String) {
    chatEvents(since: $since) {
      kind
      conversationId
      change
      message { ${MESSAGE_FIELDS} }
      userId
      online
      availability
    }
  }`,
} as const;

export type ChatOperationName = keyof typeof CHAT_OPERATIONS;
