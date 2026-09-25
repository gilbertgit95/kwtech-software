/**
 * `@kwtech/module-notification/react` — the web half.
 *
 * A SEPARATE entry point from '.', which stays framework-free. `react`,
 * `react-dom` and `@kwtech/web-ui` are optional peers for that reason.
 *
 * ⚠ NAMED exports, never `export *`: half of this barrel is `'use client'`, and
 * a client module does not answer the enumeration `export *` compiles to.
 */

export { InboxRow, type InboxRowProps } from './components/inbox-row.js';
export { NotificationHeaderTool } from './components/notification-header-tool.js';
export { NotificationItem, type NotificationItemProps } from './components/notification-item.js';
export { ToastStack, type ToastStackProps } from './components/toast-stack.js';
export {
  ADMINISTRATION_NAV_GROUP,
  type NotificationWebModuleOptions,
  notificationWebModule,
} from './module.js';
export {
  createNotificationClient,
  DEFAULT_GRAPHQL_PATH,
  type NotificationActionView,
  type NotificationBatchView,
  type NotificationClient,
  type NotificationEventView,
  type NotificationPageView,
  type NotificationRecipientView,
  type NotificationSourceView,
  type NotificationView,
} from './notification-client.js';
export {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_SETTINGS_KEY,
  type NotificationDeviceSettings,
  parseNotificationSettings,
} from './notification-settings.js';
export { useNotificationsPageOnScreen } from './notification-surface.js';
export { DEFAULT_NOTIFICATION_TONE, NOTIFICATION_TONES, notificationTone } from './notification-tones.js';
export { AdminNotificationsPage } from './pages/admin-notifications-page.js';
export { NotificationPreferencesPage } from './pages/notification-preferences-page.js';
export { NotificationsPage } from './pages/notifications-page.js';
export { NOTIFICATION_PREFERENCES_HREF, NOTIFICATIONS_ADMIN_HREF, NOTIFICATIONS_HREF } from './routes.js';
export {
  type NotificationCenterState,
  PANEL_SIZE,
  toastFor,
  useNotificationCenter,
} from './use-notification-center.js';
export { type NotificationInboxState, useNotificationInbox } from './use-notification-inbox.js';
export { useTabTitle } from './use-tab-title.js';
export {
  activeFilterCount,
  DEFAULT_INBOX_STATE,
  dayLabel,
  emptyInboxCopy,
  groupByDay,
  INBOX_BODY_FOLD,
  INBOX_PAGE_SIZES,
  type InboxState,
  type InboxTab,
  inboxRequest,
  isLongBody,
  mergeLive,
  newestOccurredAt,
  organizationsIn,
  pagerLabel,
  parseInboxState,
  relativeTime,
  serializeInboxState,
  withFilter,
} from './view/inbox-view.js';
export { type SeverityLook, severityLook } from './view/severity-view.js';
export {
  dismissToast,
  EMPTY_TOAST_QUEUE,
  newestToast,
  pushToast,
  type ToastItem,
  type ToastQueue,
} from './view/toast-queue.js';
