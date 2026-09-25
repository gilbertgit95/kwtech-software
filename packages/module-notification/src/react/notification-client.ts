'use client';

import type { NotificationOrder } from '../domain/ordering.js';
import { NOTIFICATION_OPERATIONS } from '../operations.js';

/**
 * How the notification screens reach the API — through the app's same-origin
 * route handler, which attaches the session. The path is a parameter because
 * that handler belongs to `module-auth`, and this module may not name its URL
 * (PLAN §9). The default is where this app mounts it.
 */
export const DEFAULT_GRAPHQL_PATH = '/api/auth/graphql';

export interface NotificationActionView {
  /** 'link' | 'download'. */
  kind: string;
  key: string;
  label: string;
  href: string;
  /** 'self' | 'blank' for a link. */
  target: string | null;
  filename: string | null;
}

export interface NotificationView {
  id: string;
  /** 'info' | 'success' | 'warning' | 'alert'. */
  severity: string;
  title: string;
  body: string | null;
  source: string;
  sourceLabel: string;
  organizationId: string | null;
  workspaceId: string | null;
  contextLabel: string | null;
  actions: NotificationActionView[];
  groupCount: number;
  createdAt: string;
  occurredAt: string;
  readAt: string | null;
  archivedAt: string | null;
  expiresAt: string | null;
}

export interface NotificationPageView {
  items: NotificationView[];
  hasNext: boolean;
  hasPrevious: boolean;
  startCursor: string | null;
  endCursor: string | null;
  totalCount: number;
  unreadCount: number;
}

export interface NotificationEventView {
  kind: string;
  ids: string[];
  batchId: string | null;
  notification: NotificationView | null;
}

export interface NotificationSourceView {
  key: string;
  label: string;
  mutable: boolean;
}

export interface NotificationBatchView {
  id: string;
  senderId: string | null;
  senderName: string | null;
  source: string;
  sourceLabel: string;
  severity: string;
  title: string;
  recipientCount: number;
  readCount: number;
  createdAt: string;
  recalledAt: string | null;
  recalledById: string | null;
}

export interface NotificationRecipientView {
  userId: string;
  displayName: string;
  email: string;
}

export interface NotificationListRequest {
  first?: number;
  after?: string | null;
  before?: string | null;
  order?: NotificationOrder;
  unreadOnly?: boolean;
  archived?: boolean;
  severity?: string | null;
  source?: string | null;
  organizationId?: string | null;
  globalOnly?: boolean;
}

export interface NotificationSendRequest {
  recipientIds: string[];
  severity: string;
  title: string;
  body: string | null;
  linkLabel: string | null;
  linkHref: string | null;
}

export interface NotificationClient {
  list(request: NotificationListRequest): Promise<NotificationPageView>;
  unreadCount(): Promise<number>;
  since(since: string): Promise<{ items: NotificationView[]; total: number }>;
  sources(): Promise<NotificationSourceView[]>;
  markRead(ids: readonly string[]): Promise<number>;
  markUnread(ids: readonly string[]): Promise<number>;
  markAllRead(before: string): Promise<number>;
  archive(ids: readonly string[]): Promise<number>;
  unarchive(ids: readonly string[]): Promise<number>;

  send(request: NotificationSendRequest): Promise<NotificationBatchView>;
  batches(request: { first?: number; after?: string | null; mineOnly?: boolean }): Promise<{
    items: NotificationBatchView[];
    nextCursor: string | null;
  }>;
  recall(batchId: string): Promise<NotificationBatchView>;
  searchRecipients(query: string): Promise<NotificationRecipientView[]>;
}

export function createNotificationClient(options: { graphqlPath?: string } = {}): NotificationClient {
  const path = options.graphqlPath ?? DEFAULT_GRAPHQL_PATH;
  const ops = NOTIFICATION_OPERATIONS;

  async function graphql<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ query: document, variables }),
        cache: 'no-store',
      });
    } catch {
      throw new Error('Cannot reach the server.');
    }
    if (!response.ok) {
      throw new Error(response.status === 401 ? 'Your session has ended. Sign in again.' : 'Cannot reach the server.');
    }
    const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'The request was refused.');
    if (!body.data) throw new Error('The server returned no data.');
    return body.data;
  }

  return {
    async list(request) {
      return (await graphql<{ notifications: NotificationPageView }>(ops.notifications, { ...request })).notifications;
    },
    async unreadCount() {
      return (await graphql<{ notificationUnreadCount: number }>(ops.notificationUnreadCount)).notificationUnreadCount;
    },
    async since(since) {
      return (
        await graphql<{ notificationsSince: { items: NotificationView[]; total: number } }>(ops.notificationsSince, {
          since,
        })
      ).notificationsSince;
    },
    async sources() {
      return (await graphql<{ notificationSources: NotificationSourceView[] }>(ops.notificationSources))
        .notificationSources;
    },
    async markRead(ids) {
      return (await graphql<{ markNotificationsRead: number }>(ops.markNotificationsRead, { ids: [...ids] }))
        .markNotificationsRead;
    },
    async markUnread(ids) {
      return (await graphql<{ markNotificationsUnread: number }>(ops.markNotificationsUnread, { ids: [...ids] }))
        .markNotificationsUnread;
    },
    async markAllRead(before) {
      return (await graphql<{ markAllNotificationsRead: number }>(ops.markAllNotificationsRead, { before }))
        .markAllNotificationsRead;
    },
    async archive(ids) {
      return (await graphql<{ archiveNotifications: number }>(ops.archiveNotifications, { ids: [...ids] }))
        .archiveNotifications;
    },
    async unarchive(ids) {
      return (await graphql<{ unarchiveNotifications: number }>(ops.unarchiveNotifications, { ids: [...ids] }))
        .unarchiveNotifications;
    },

    async send(request) {
      return (await graphql<{ sendNotification: NotificationBatchView }>(ops.sendNotification, { input: request }))
        .sendNotification;
    },
    async batches(request) {
      return (
        await graphql<{ notificationBatches: { items: NotificationBatchView[]; nextCursor: string | null } }>(
          ops.notificationBatches,
          { ...request },
        )
      ).notificationBatches;
    },
    async recall(batchId) {
      return (
        await graphql<{ recallNotificationBatch: NotificationBatchView }>(ops.recallNotificationBatch, { batchId })
      ).recallNotificationBatch;
    },
    async searchRecipients(query) {
      return (
        await graphql<{ notificationRecipientSearch: NotificationRecipientView[] }>(ops.notificationRecipientSearch, {
          query,
        })
      ).notificationRecipientSearch;
    },
  };
}
