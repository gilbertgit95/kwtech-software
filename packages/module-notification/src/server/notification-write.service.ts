import { Inject, Injectable } from '@nestjs/common';
import { NOTIFICATION_BULK_MAX, prepareBulkIds } from '../domain/bulk.js';
import { NotificationWriteError } from './notification.errors.js';
import { NotificationEventPublisher } from './notification.events.js';
import type { ItemUpdate, ItemWhere, NotificationWriteClient } from './notification.repository.js';
import { NOTIFICATION_PRISMA_WRITE } from './notification.tokens.js';

/**
 * Changing somebody's own notifications: read, unread, archived — and a recall,
 * which is the one write that reaches other people's.
 *
 * ⚠ Every mark is filtered by RECIPIENT in the where-clause itself, so an id
 * that is not yours matches nothing and is skipped silently. Reporting it
 * would confirm the row exists.
 */
@Injectable()
export class NotificationWriteService {
  constructor(
    @Inject(NOTIFICATION_PRISMA_WRITE) private readonly prisma: NotificationWriteClient,
    private readonly events: NotificationEventPublisher,
  ) {}

  /** Returns how many changed. Already-read rows are left alone, not re-stamped. */
  async markRead(actorId: string, ids: readonly string[]): Promise<number> {
    return this.mark(actorId, ids, { readAt: null }, { readAt: new Date() }, 'read');
  }

  async markUnread(actorId: string, ids: readonly string[]): Promise<number> {
    return this.mark(actorId, ids, { readAt: { not: null } }, { readAt: null }, 'unread');
  }

  async archive(actorId: string, ids: readonly string[]): Promise<number> {
    return this.mark(actorId, ids, { archivedAt: null }, { archivedAt: new Date() }, 'archived');
  }

  async unarchive(actorId: string, ids: readonly string[]): Promise<number> {
    return this.mark(actorId, ids, { archivedAt: { not: null } }, { archivedAt: null }, 'unarchived');
  }

  /**
   * Everything unread up to `before` — the newest `occurredAt` the client had
   * SEEN.
   *
   * ⚠ Without the bound, "mark all read" would also mark the notification that
   * arrived while the person was clicking, and they would never see it.
   */
  async markAllRead(actorId: string, before: string): Promise<number> {
    const bound = new Date(before);
    if (Number.isNaN(bound.getTime())) throw new NotificationWriteError('invalid', 'That is not a valid time.');
    const { count } = await this.prisma.notificationItem.updateMany({
      where: { recipientId: actorId, readAt: null, archivedAt: null, recalledAt: null, occurredAt: { lte: bound } },
      data: { readAt: new Date() },
    });
    if (count > 0) await this.events.changed('read', actorId, []);
    return count;
  }

  /**
   * Takes a send back from every inbox it reached. Idempotent: recalling a
   * recalled batch returns it unchanged.
   *
   * ⚠ Soft. The rows stay, with `recalledAt`, and every read drops them — so
   * the Sent list keeps the record of what was said and taken back.
   *
   * ⚠ It clears `dedupeKey` on those rows, or the unique constraint would
   * silently swallow the corrected re-send that usually follows a recall.
   *
   * ⚠ A row that later sends FOLDED into keeps the batch that started it, so
   * recalling a later batch does not remove it. The compose screen offers no
   * grouping for exactly this reason: everything a person recalls from the
   * Sent list is one row per recipient.
   */
  async recall(actorId: string, batchId: string): Promise<void> {
    const batch = await this.prisma.notificationBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotificationWriteError('not_found', 'That send does not exist.');
    if (batch.recalledAt) return;

    const now = new Date();
    const rows = await this.prisma.$transaction(async (tx) => {
      const live = await tx.notificationItem.findMany({ where: { batchId, recalledAt: null } });
      await tx.notificationItem.updateMany({
        where: { batchId, recalledAt: null },
        data: { recalledAt: now, dedupeKey: null },
      });
      await tx.notificationBatch.update({ where: { id: batchId }, data: { recalledAt: now, recalledById: actorId } });
      return live;
    });

    // After the commit: every open tab drops the item, its toast and its count.
    await Promise.all(rows.map((row) => this.events.changed('recalled', row.recipientId, [row.id])));
  }

  private async mark(
    actorId: string,
    ids: readonly string[],
    only: ItemWhere,
    data: ItemUpdate,
    kind: 'read' | 'unread' | 'archived' | 'unarchived',
  ): Promise<number> {
    const unique = prepareBulkIds(ids);
    if (!unique) {
      throw new NotificationWriteError(
        'invalid',
        `At most ${NOTIFICATION_BULK_MAX} notifications can be changed at once.`,
      );
    }
    if (unique.length === 0) return 0;
    const { count } = await this.prisma.notificationItem.updateMany({
      where: { recipientId: actorId, id: { in: unique }, recalledAt: null, ...only },
      data,
    });
    // Only when something changed: an event means "go re-read", and a re-read
    // that finds nothing new is a query every other open tab pays for.
    if (count > 0) await this.events.changed(kind, actorId, unique);
    return count;
  }
}
