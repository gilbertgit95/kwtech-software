/**
 * Every GraphQL document this module sends, as data.
 *
 * A document is the one part of a typed client nothing typechecks: a renamed
 * field is a runtime refusal on a screen. Lifted out here, the app validates
 * every one against the schema it serves —
 * `apps/web-server/test/module-operations.test.ts`.
 *
 * ⚠ FRAMEWORK-FREE, and exported from the package ROOT rather than `/react`, so
 * a server validating them never resolves React to read a string.
 */

const ACTION = 'kind key label href target filename';
const NOTIFICATION = `id severity title body source sourceLabel organizationId workspaceId contextLabel
  actions { ${ACTION} } groupCount createdAt occurredAt readAt archivedAt expiresAt`;
const BATCH = `id senderId senderName source sourceLabel severity title recipientCount readCount createdAt recalledAt
  recalledById`;

export const NOTIFICATION_OPERATIONS = {
  /**
   * One page of the inbox. Unread first unless `order` says `newest`. Pass
   * `after` for the next page or `before` for the previous one — never both.
   */
  notifications: `query Notifications(
    $first: Int, $after: String, $before: String, $order: String, $unreadOnly: Boolean, $archived: Boolean,
    $severity: String, $source: String, $organizationId: String, $globalOnly: Boolean
  ) {
    notifications(
      first: $first, after: $after, before: $before, order: $order, unreadOnly: $unreadOnly, archived: $archived,
      severity: $severity, source: $source, organizationId: $organizationId, globalOnly: $globalOnly
    ) {
      items { ${NOTIFICATION} }
      hasNext hasPrevious startCursor endCursor totalCount unreadCount
    }
  }`,

  /** The bell's number. Re-read after every event rather than counted locally. */
  notificationUnreadCount: `query NotificationUnreadCount { notificationUnreadCount }`,

  /**
   * What arrived after `since` — read once after a reconnect, to toast the
   * alerts that were missed and summarise the rest.
   */
  notificationsSince: `query NotificationsSince($since: String!) {
    notificationsSince(since: $since) { items { ${NOTIFICATION} } total }
  }`,

  /** Every declared source, for the filter and the compose screen. */
  notificationSources: `query NotificationSources { notificationSources { key label mutable } }`,

  markNotificationsRead: `mutation MarkNotificationsRead($ids: [String!]!) { markNotificationsRead(ids: $ids) }`,
  markNotificationsUnread: `mutation MarkNotificationsUnread($ids: [String!]!) { markNotificationsUnread(ids: $ids) }`,
  /**
   * ⚠ `before` is the newest `occurredAt` the client has SEEN. Without it,
   * "mark all read" would also mark the notification that arrived while the
   * person was clicking.
   */
  markAllNotificationsRead: `mutation MarkAllNotificationsRead($before: String!) {
    markAllNotificationsRead(before: $before)
  }`,
  archiveNotifications: `mutation ArchiveNotifications($ids: [String!]!) { archiveNotifications(ids: $ids) }`,
  unarchiveNotifications: `mutation UnarchiveNotifications($ids: [String!]!) { unarchiveNotifications(ids: $ids) }`,

  /**
   * The stream. `sync` arrives first on every (re)subscribe; the client
   * re-reads on it. Every other event carries the notification it is about.
   */
  notificationEvents: `subscription NotificationEvents {
    notificationEvents { kind ids batchId notification { ${NOTIFICATION} } }
  }`,

  // ── the compose screen (notification:send / notification:manage) ─────────

  sendNotification: `mutation SendNotification($input: NotificationSendInput!) {
    sendNotification(input: $input) { ${BATCH} }
  }`,
  notificationBatches: `query NotificationBatches($first: Int, $after: String, $mineOnly: Boolean) {
    notificationBatches(first: $first, after: $after, mineOnly: $mineOnly) { items { ${BATCH} } nextCursor }
  }`,
  recallNotificationBatch: `mutation RecallNotificationBatch($batchId: String!) {
    recallNotificationBatch(batchId: $batchId) { ${BATCH} }
  }`,
  notificationRecipientSearch: `query NotificationRecipientSearch($query: String!) {
    notificationRecipientSearch(query: $query) { userId displayName email }
  }`,
} as const;
