import { readActions } from '../domain/actions.js';
import { readContext } from '../domain/context.js';
import type { NotificationConfig } from './notification.options.js';
import type { BatchRow, ItemRow } from './notification.repository.js';

/**
 * A row as it crosses the wire — to a query, AND inside a realtime event.
 *
 * ⚠ ONE rendering for both. The event carries the notification so a toast can
 * draw without a second request, and an event rendered differently from the
 * list would show a toast that disagrees with the row it opens.
 *
 * ⚠ JSON-SAFE: ISO strings, never `Date`. With Redis behind the engine an event
 * is JSON on the way through, and a `Date` arrives as a string.
 */
export interface NotificationPayload {
  id: string;
  severity: string;
  title: string;
  body: string | null;
  source: string;
  sourceLabel: string;
  organizationId: string | null;
  workspaceId: string | null;
  contextLabel: string | null;
  actions: NotificationActionPayload[];
  groupCount: number;
  createdAt: string;
  occurredAt: string;
  readAt: string | null;
  archivedAt: string | null;
  expiresAt: string | null;
}

export interface NotificationActionPayload {
  kind: string;
  key: string;
  label: string;
  href: string;
  target: string | null;
  filename: string | null;
}

/**
 * The payload for a row, or null for a row holding the one context shape that
 * is not allowed (a workspace with no organization) — dropped rather than drawn
 * as something it is not. The caller logs it.
 *
 * ⚠ An EXPIRED notification renders with no buttons. The client says "expired"
 * from `expiresAt`; the server is what makes sure a stale link is not offered.
 */
export function renderNotification(row: ItemRow, config: NotificationConfig, now: Date): NotificationPayload | null {
  if (readContext(row) === null) return null;
  const expired = row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime();
  const actions = expired ? [] : readActions(row.actions, config.hrefPolicy);
  return {
    id: row.id,
    severity: row.severity,
    title: row.title,
    body: row.body,
    source: row.source,
    // A source the app has since stopped declaring still shows SOMETHING
    // readable: its key, rather than a blank where the label goes.
    sourceLabel: config.sourceByKey.get(row.source)?.label ?? row.source,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    contextLabel: row.contextLabel,
    actions: actions.map((action) => ({
      kind: action.kind,
      key: action.key,
      label: action.label,
      href: action.href,
      target: action.kind === 'link' ? action.target : null,
      filename: action.kind === 'download' ? (action.filename ?? null) : null,
    })),
    groupCount: row.groupCount,
    createdAt: row.createdAt.toISOString(),
    occurredAt: row.occurredAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

export interface NotificationBatchPayload {
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

export function renderBatch(
  row: BatchRow,
  config: NotificationConfig,
  extra: { senderName: string | null; readCount: number },
): NotificationBatchPayload {
  return {
    id: row.id,
    senderId: row.senderId,
    senderName: extra.senderName,
    source: row.source,
    sourceLabel: config.sourceByKey.get(row.source)?.label ?? row.source,
    severity: row.severity,
    title: row.title,
    recipientCount: row.recipientCount,
    readCount: extra.readCount,
    createdAt: row.createdAt.toISOString(),
    recalledAt: row.recalledAt?.toISOString() ?? null,
    recalledById: row.recalledById,
  };
}
