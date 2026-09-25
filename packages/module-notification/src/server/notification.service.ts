import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  isNotificationOrder,
  type NotificationCursor,
  type NotificationOrder,
  type NotificationRun,
  planPage,
  runOf,
  runsFor,
} from '../domain/ordering.js';
import { isNotificationSeverity, type NotificationSource } from '../types.js';
import { NotificationWriteError } from './notification.errors.js';
import type { NotificationConfig } from './notification.options.js';
import {
  type NotificationBatchPayload,
  type NotificationPayload,
  renderBatch,
  renderNotification,
} from './notification.render.js';
import type { BatchRow, ItemRow, ItemWhere, NotificationPrismaClient } from './notification.repository.js';
import { NOTIFICATION_CONFIG, NOTIFICATION_PRISMA, NOTIFICATION_USER_DIRECTORY } from './notification.tokens.js';
import type { NotificationRecipientView, NotificationUserDirectory } from './ports.js';

export interface NotificationListQuery {
  first?: number | null;
  after?: string | null;
  before?: string | null;
  /** 'unread_first' (default) | 'newest'. Anything else is refused. */
  order?: string | null;
  unreadOnly?: boolean | null;
  archived?: boolean | null;
  /** A severity, or null for all. Anything else is refused. */
  severity?: string | null;
  source?: string | null;
  organizationId?: string | null;
  globalOnly?: boolean | null;
}

export interface NotificationPage {
  items: NotificationPayload[];
  hasNext: boolean;
  hasPrevious: boolean;
  startCursor: string | null;
  endCursor: string | null;
  /** Everything the filter matches, across every page. */
  totalCount: number;
  /** How many of those are unread. */
  unreadCount: number;
}

/**
 * At most this many missed notifications come back after a reconnect. The
 * alerts among them get their own toasts; `total` counts every one, so the
 * summary is still right when more were missed than were fetched.
 */
export const NOTIFICATION_SINCE_MAX = 50;

/** Sent-list page size. */
export const NOTIFICATION_BATCH_PAGE = 20;

/**
 * Reading somebody's notifications.
 *
 * ⚠ EVERY QUERY IS FILTERED BY RECIPIENT, here, whatever the guard decided.
 * `notification:read` says you may read notifications; it says nothing about
 * whose. A row that is not yours is not found — never "forbidden", which would
 * confirm it exists.
 *
 * ⚠ And every query drops RECALLED rows. A recall is a promise that the words
 * are gone from every inbox, and one query that forgot the filter would break it.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger('Notifications');

  constructor(
    @Inject(NOTIFICATION_PRISMA) private readonly prisma: NotificationPrismaClient,
    @Inject(NOTIFICATION_CONFIG) private readonly config: NotificationConfig,
    /** Absent: the compose screen finds nobody, and the Sent list shows no names. */
    @Optional() @Inject(NOTIFICATION_USER_DIRECTORY) private readonly directory?: NotificationUserDirectory,
  ) {}

  /** One page of the inbox. See `domain/ordering.ts` for the walk. */
  async list(actorId: string, query: NotificationListQuery, now: Date = new Date()): Promise<NotificationPage> {
    if (query.after && query.before) {
      throw new NotificationWriteError('invalid', 'Ask for the page after a row or before one, not both.');
    }
    const after = query.after ? this.cursor(query.after) : null;
    const before = query.before ? this.cursor(query.before) : null;

    if (query.order && !isNotificationOrder(query.order)) {
      throw new NotificationWriteError('invalid', 'The order must be "unread_first" or "newest".');
    }
    if (query.severity && !isNotificationSeverity(query.severity)) {
      throw new NotificationWriteError('invalid', 'That severity does not exist.');
    }
    const order: NotificationOrder = query.order && isNotificationOrder(query.order) ? query.order : 'unread_first';
    const unreadOnly = query.unreadOnly ?? false;
    const size = clampPageSize(query.first);
    const base = this.baseWhere(actorId, query);
    const plan = planPage(runsFor(order, unreadOnly), { after, before });
    const forward = plan.direction === 'forward';

    /*
     * One row past the page, so "is there more in this direction" is answered
     * by the same queries that fill it. ⚠ Sequential, not parallel: each step
     * only runs if the one before it did not fill the page, and the runs must
     * stay in order.
     */
    const wanted = size + 1;
    const rows: ItemRow[] = [];
    for (const step of plan.steps) {
      const remaining = wanted - rows.length;
      if (remaining <= 0) break;
      const where: ItemWhere = {
        ...base,
        ...runWhere(step.run),
        ...(step.from ? keyset(step.from, forward) : {}),
      };
      const found = await this.prisma.notificationItem.findMany({
        where,
        orderBy: forward ? [{ occurredAt: 'desc' }, { id: 'desc' }] : [{ occurredAt: 'asc' }, { id: 'asc' }],
        take: remaining,
      });
      rows.push(...found);
    }

    const more = rows.length > size;
    const page = rows.slice(0, size);
    if (!forward) page.reverse();

    const [totalCount, unreadCount] = await Promise.all([
      this.prisma.notificationItem.count({ where: unreadOnly ? { ...base, readAt: null } : base }),
      this.prisma.notificationItem.count({ where: { ...base, readAt: null } }),
    ]);

    const first = page[0];
    const last = page.at(-1);
    const cursorOf = (row: ItemRow) =>
      encodeCursor({ run: runOf(row, order, unreadOnly), occurredAt: row.occurredAt, id: row.id });

    return {
      items: this.renderAll(page, now),
      /*
       * Going forward, "more" is the next page and a cursor we came from is the
       * previous one; going back, the other way round. The side we came from is
       * reported as present without a query — the page that linked here existed
       * a moment ago, and a Previous that opens an empty page is a smaller harm
       * than a second count on every page turn.
       */
      hasNext: forward ? more : true,
      hasPrevious: forward ? after !== null : more,
      startCursor: first ? cursorOf(first) : null,
      endCursor: last ? cursorOf(last) : null,
      totalCount,
      unreadCount,
    };
  }

  /** The bell's number: unread, not archived, not recalled. */
  async unreadCount(actorId: string): Promise<number> {
    return this.prisma.notificationItem.count({
      where: { recipientId: actorId, readAt: null, archivedAt: null, recalledAt: null },
    });
  }

  /**
   * What arrived after `since` — asked once after a reconnect, so missed alerts
   * get their toasts and the rest one summary.
   */
  async since(
    actorId: string,
    since: string,
    now: Date = new Date(),
  ): Promise<{ items: NotificationPayload[]; total: number }> {
    const from = new Date(since);
    if (Number.isNaN(from.getTime())) throw new NotificationWriteError('invalid', 'That is not a valid time.');
    const where: ItemWhere = { recipientId: actorId, archivedAt: null, recalledAt: null, occurredAt: { gt: from } };
    const [rows, total] = await Promise.all([
      this.prisma.notificationItem.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: NOTIFICATION_SINCE_MAX,
      }),
      this.prisma.notificationItem.count({ where }),
    ]);
    return { items: this.renderAll(rows, now), total };
  }

  sources(): readonly NotificationSource[] {
    return this.config.sources;
  }

  /** The Sent list, newest first. `mineOnly` narrows it to what the actor sent. */
  async batches(
    actorId: string,
    query: { first?: number | null; after?: string | null; mineOnly?: boolean | null },
  ): Promise<{ items: NotificationBatchPayload[]; nextCursor: string | null }> {
    const size = Math.min(clampPageSize(query.first ?? NOTIFICATION_BATCH_PAGE), NOTIFICATION_BATCH_PAGE * 5);
    const after = query.after ? this.cursor(query.after) : null;
    const rows = await this.prisma.notificationBatch.findMany({
      where: {
        ...(query.mineOnly ? { senderId: actorId } : {}),
        ...(after
          ? { OR: [{ createdAt: { lt: after.occurredAt } }, { createdAt: after.occurredAt, id: { lt: after.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: size + 1,
    });
    const page = rows.slice(0, size);
    return {
      items: await this.renderBatches(page),
      nextCursor:
        rows.length > size && page.at(-1)
          ? encodeCursor({
              run: 'all',
              occurredAt: (page.at(-1) as BatchRow).createdAt,
              id: (page.at(-1) as BatchRow).id,
            })
          : null,
    };
  }

  /** One batch, rendered, or null. */
  async batch(batchId: string): Promise<NotificationBatchPayload | null> {
    const row = await this.prisma.notificationBatch.findUnique({ where: { id: batchId } });
    if (!row) return null;
    const [rendered] = await this.renderBatches([row]);
    return rendered ?? null;
  }

  /** People for the compose screen. Empty when the app bound no directory. */
  async searchRecipients(query: string): Promise<NotificationRecipientView[]> {
    const trimmed = query.trim();
    // Two characters before searching: one matches half the directory, and the
    // compose screen asks on every keystroke.
    if (trimmed.length < 2 || !this.directory) return [];
    return this.directory.search(trimmed.slice(0, 100), 10);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private cursor(value: string): NotificationCursor {
    const cursor = decodeCursor(value);
    if (!cursor)
      throw new NotificationWriteError('invalid', 'That page link is no longer valid. Go back to the first page.');
    return cursor;
  }

  private baseWhere(actorId: string, query: NotificationListQuery): ItemWhere {
    return {
      recipientId: actorId,
      recalledAt: null,
      archivedAt: query.archived ? { not: null } : null,
      ...(query.severity && isNotificationSeverity(query.severity) ? { severity: query.severity } : {}),
      ...(query.source ? { source: query.source } : {}),
      // Global wins over a named organization: asking for both is asking for
      // nothing, and "global" is the narrower, explicit filter.
      ...(query.globalOnly
        ? { organizationId: null }
        : query.organizationId
          ? { organizationId: query.organizationId }
          : {}),
    };
  }

  private renderAll(rows: readonly ItemRow[], now: Date): NotificationPayload[] {
    const rendered: NotificationPayload[] = [];
    for (const row of rows) {
      const payload = renderNotification(row, this.config, now);
      if (payload) {
        rendered.push(payload);
        continue;
      }
      this.logger.warn(`Notification ${row.id} has a workspace but no organization; it was not shown.`);
    }
    return rendered;
  }

  /** One directory call and one count per batch on the page — a page is twenty. */
  private async renderBatches(rows: readonly BatchRow[]): Promise<NotificationBatchPayload[]> {
    const senderIds = [...new Set(rows.map((row) => row.senderId).filter((id): id is string => id !== null))];
    const [names, readCounts] = await Promise.all([
      senderIds.length > 0 && this.directory
        ? this.directory.names(senderIds)
        : Promise.resolve(new Map<string, string>()),
      Promise.all(
        rows.map((row) => this.prisma.notificationItem.count({ where: { batchId: row.id, readAt: { not: null } } })),
      ),
    ]);
    return rows.map((row, index) =>
      renderBatch(row, this.config, {
        senderName: row.senderId ? (names.get(row.senderId) ?? null) : null,
        readCount: readCounts[index] ?? 0,
      }),
    );
  }
}

/** The part of the where-clause that selects one run. */
function runWhere(run: NotificationRun): ItemWhere {
  switch (run) {
    case 'unread':
      return { readAt: null };
    case 'read':
      return { readAt: { not: null } };
    case 'all':
      return {};
  }
}

/** Strictly past `(occurredAt, id)`: older going forward, newer going back. */
function keyset(from: NotificationCursor, forward: boolean): ItemWhere {
  return forward
    ? { OR: [{ occurredAt: { lt: from.occurredAt } }, { occurredAt: from.occurredAt, id: { lt: from.id } }] }
    : { OR: [{ occurredAt: { gt: from.occurredAt } }, { occurredAt: from.occurredAt, id: { gt: from.id } }] };
}
