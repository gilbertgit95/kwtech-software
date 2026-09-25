import type { FeatureContribution } from '@kwtech/module-kit';

/**
 * What `module-notification` declares, for the app to compose and sync.
 *
 * ## Every key is APP level
 *
 * The inbox belongs to a PERSON, not to a tenant: one list and one count cover
 * every organization and workspace they are in. There is no organization or
 * workspace to resolve a key against, so no resolver here declares a scope —
 * the same as chat.
 *
 * ## ⚠ THE BINDINGS ARE THE GUARD
 *
 * This module cannot use `@RequireFeature` (it belongs to module-permissions,
 * and a module may not import a module — PLAN §9). Every operation is guarded by
 * its binding below, which the app composes into the feature registry and
 * `FeatureGuard` enforces. `test/surface-coverage.test.ts` fails the build on an
 * operation that is neither bound nor listed as deliberately unbound.
 *
 * ## And the guard is only half
 *
 * Holding `notification:read` lets you read YOUR notifications. Every query and
 * write also filters by the recipient, in the service, so the key never reaches
 * anybody else's row.
 */
export const NOTIFICATION_FEATURE = {
  /** Your own inbox: read it, mark it, archive it, and stay live on it. */
  read: 'notification:read',
  /** Send a notification to chosen people, as the platform; see your sends. */
  send: 'notification:send',
  /** Recall a send — anybody's, including the system's. */
  manage: 'notification:manage',
} as const;

export type NotificationFeatureKey = (typeof NOTIFICATION_FEATURE)[keyof typeof NOTIFICATION_FEATURE];

export const NOTIFICATION_FEATURE_REGISTRY: readonly FeatureContribution[] = [
  {
    key: NOTIFICATION_FEATURE.read,
    module: 'notification',
    level: 'app',
    label: 'Receive notifications',
    description: 'See your own notifications, mark them read or unread, archive them, and receive them live.',
    tags: ['notification'],
    bindings: [
      { surface: 'graphql_operation', identifier: 'Query.notifications' },
      { surface: 'graphql_operation', identifier: 'Query.notificationUnreadCount' },
      { surface: 'graphql_operation', identifier: 'Query.notificationsSince' },
      { surface: 'graphql_operation', identifier: 'Query.notificationSources' },
      { surface: 'graphql_operation', identifier: 'Mutation.markNotificationsRead' },
      { surface: 'graphql_operation', identifier: 'Mutation.markNotificationsUnread' },
      { surface: 'graphql_operation', identifier: 'Mutation.markAllNotificationsRead' },
      { surface: 'graphql_operation', identifier: 'Mutation.archiveNotifications' },
      { surface: 'graphql_operation', identifier: 'Mutation.unarchiveNotifications' },
      /*
       * ⚠ Its own surface: a subscription is authorised ONCE, at subscribe, and
       * then streams. What bounds how stale that answer can get is the socket
       * closing at token expiry. Who receives each event is re-decided on every
       * publish — the recipient filter — which is what keeps one person's
       * stream from ever carrying another's notification.
       */
      { surface: 'graphql_subscription', identifier: 'Subscription.notificationEvents' },
    ],
  },
  {
    key: NOTIFICATION_FEATURE.send,
    module: 'notification',
    /*
     * PRIVILEGED: it puts words in front of people with the platform's name on
     * them. Person-to-person messages are chat's job; this is the platform
     * speaking, which is why the recipient sees "Platform" and never the sender.
     */
    isPrivileged: true,
    level: 'app',
    label: 'Send notifications',
    description: 'Send a notification to chosen people as the platform, and see what you have sent.',
    tags: ['notification'],
    bindings: [
      { surface: 'graphql_operation', identifier: 'Mutation.sendNotification' },
      { surface: 'graphql_operation', identifier: 'Query.notificationBatches' },
      { surface: 'graphql_operation', identifier: 'Query.notificationRecipientSearch' },
    ],
  },
  {
    key: NOTIFICATION_FEATURE.manage,
    module: 'notification',
    isPrivileged: true,
    level: 'app',
    label: 'Recall notifications',
    description: 'Take back a send from every inbox it reached — including notifications the system sent.',
    tags: ['notification'],
    bindings: [{ surface: 'graphql_operation', identifier: 'Mutation.recallNotificationBatch' }],
  },
];

/**
 * A role a host MAY create, exported as DATA and never seeded here — the same
 * arrangement as chat's presets. Adopting the module grants nobody anything
 * until the app says who receives notifications.
 */
export interface NotificationRolePreset {
  key: string;
  label: string;
  icon: string;
  features: readonly string[];
}

export const NOTIFICATION_ROLE_PRESETS: readonly NotificationRolePreset[] = [
  {
    key: 'notification-user',
    label: 'Notification user',
    icon: 'bell',
    features: [NOTIFICATION_FEATURE.read],
  },
];
