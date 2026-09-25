import { Inject, Injectable, Logger } from '@nestjs/common';
import { type NotificationSendInput, prepareSend } from '../domain/compose.js';
import { floodWindowStart, isFlooded } from '../domain/flood.js';
import { louderSeverity, overflowGroup, renderGroupTitle } from '../domain/grouping.js';
import { NOTIFICATION_PLATFORM_SOURCE } from '../domain/sources.js';
import { isNotificationSeverity } from '../types.js';
import { NotificationWriteError } from './notification.errors.js';
import { NotificationEventPublisher } from './notification.events.js';
import type { NotificationConfig } from './notification.options.js';
import { renderNotification } from './notification.render.js';
import type { ItemCreate, ItemRow, NotificationWriteClient } from './notification.repository.js';
import { NOTIFICATION_CONFIG, NOTIFICATION_PRISMA_WRITE } from './notification.tokens.js';

export interface NotificationSendResult {
  batchId: string;
  /** New rows written. */
  written: number;
  /** Sends that folded into a recipient's open group instead of adding a row. */
  grouped: number;
  /** Of those, how many folded because the source was flooding (§12). */
  overflowed: number;
}

/**
 * How the app SENDS a notification — the one write path, used by every
 * producer and by the compose screen alike.
 *
 * ```ts
 * await sender.send({
 *   recipientIds: [userId],
 *   severity: 'alert',
 *   title: 'The queue session was stopped',
 *   source: 'queue.session',
 *   context: { scope: 'workspace', organizationId, workspaceId, label: 'Acme · Front desk' },
 * });
 * ```
 *
 * ⚠ OTHER MODULES NEVER IMPORT THIS. A module that wants to tell somebody
 * something declares its own port, and the app binds that port to this — the
 * same arrangement as `CHAT_NOTIFIER` bound to email (PLAN §9).
 *
 * ## The order of work
 *
 * Validate (pure, `prepareSend`), then ONE transaction that writes the batch,
 * folds into open groups, applies the flood rule and writes the rows, THEN
 * publish. Publishing after the commit means no tab is told about a row a
 * rollback removed; a failed publish never fails the send, because the row is
 * committed and the reconnect catch-up delivers it.
 */
@Injectable()
export class NotificationSender {
  private readonly logger = new Logger('NotificationSender');

  constructor(
    @Inject(NOTIFICATION_PRISMA_WRITE) private readonly prisma: NotificationWriteClient,
    @Inject(NOTIFICATION_CONFIG) private readonly config: NotificationConfig,
    private readonly events: NotificationEventPublisher,
  ) {}

  /**
   * Sends, or throws `NotificationWriteError` naming what was wrong with the
   * input. For a producer that wants to know.
   */
  async send(input: NotificationSendInput): Promise<NotificationSendResult> {
    const prepared = prepareSend(input, {
      sources: this.config.sources,
      maxRecipients: this.config.maxRecipients,
      hrefPolicy: this.config.hrefPolicy,
    });
    if ('refused' in prepared) throw new NotificationWriteError(prepared.refused, prepared.message);

    const now = new Date();
    const overflow = overflowGroup(prepared.source);

    const outcome = await this.prisma.$transaction(async (tx) => {
      const batch = await tx.notificationBatch.create({
        data: {
          senderId: prepared.senderId,
          source: prepared.source.key,
          severity: prepared.severity,
          title: prepared.title,
          recipientCount: 0,
        },
      });

      /*
       * ── the flood rule ──────────────────────────────────────────────────
       * One read for every recipient: the rows each got from this source in
       * the last minute. Bounded by the rule itself — past the limit nobody
       * gets new rows, only folds — so this is at most (limit + 1) rows each.
       */
      const recent = await tx.notificationItem.findMany({
        where: {
          recipientId: { in: prepared.recipientIds },
          source: prepared.source.key,
          createdAt: { gte: floodWindowStart(now) },
        },
      });
      const recentCount = new Map<string, number>();
      for (const row of recent) recentCount.set(row.recipientId, (recentCount.get(row.recipientId) ?? 0) + 1);

      const groupFor = (recipientId: string) =>
        isFlooded(recentCount.get(recipientId) ?? 0, this.config.floodLimit) ? overflow : prepared.group;

      /*
       * ── the open groups ─────────────────────────────────────────────────
       * At most two keys can be involved — the producer's group and the
       * overflow — so at most two reads, whatever the number of recipients.
       */
      const keys = new Set<string>();
      for (const recipientId of prepared.recipientIds) {
        const group = groupFor(recipientId);
        if (group) keys.add(group.key);
      }
      const open = new Map<string, ItemRow>();
      for (const key of keys) {
        const rows = await tx.notificationItem.findMany({
          where: {
            recipientId: { in: prepared.recipientIds },
            groupKey: key,
            readAt: null,
            archivedAt: null,
            recalledAt: null,
          },
        });
        for (const row of rows) open.set(`${row.recipientId}\u0000${key}`, row);
      }

      const toCreate: ItemCreate[] = [];
      const toFold: Array<{ row: ItemRow; group: { key: string; title: string }; overflowed: boolean }> = [];
      let overflowed = 0;
      for (const recipientId of prepared.recipientIds) {
        const group = groupFor(recipientId);
        const isOverflow = group === overflow;
        if (isOverflow) overflowed += 1;
        const existing = group ? open.get(`${recipientId}\u0000${group.key}`) : undefined;
        if (group && existing) {
          toFold.push({ row: existing, group, overflowed: isOverflow });
          continue;
        }
        toCreate.push({
          recipientId,
          severity: prepared.severity,
          title: prepared.title,
          body: prepared.body,
          source: prepared.source.key,
          organizationId: prepared.organizationId,
          workspaceId: prepared.workspaceId,
          contextLabel: prepared.contextLabel,
          actions: prepared.actions,
          dedupeKey: prepared.dedupeKey,
          batchId: batch.id,
          groupKey: group?.key ?? null,
          expiresAt: prepared.expiresAt,
        });
      }

      const created =
        toCreate.length > 0
          ? await tx.notificationItem.createManyAndReturn({ data: toCreate, skipDuplicates: true })
          : [];

      // ⚠ Sequential: each fold is its own row, and they share the transaction.
      const folded: ItemRow[] = [];
      for (const { row, group } of toFold) {
        const count = row.groupCount + 1;
        folded.push(
          await tx.notificationItem.update({
            where: { id: row.id },
            data: {
              groupCount: { increment: 1 },
              title: renderGroupTitle(group.title, count, prepared.title),
              body: prepared.body,
              actions: prepared.actions,
              severity: louderSeverity(row.severity, prepared.severity),
              occurredAt: now,
              expiresAt: prepared.expiresAt,
            },
          }),
        );
      }

      await tx.notificationBatch.update({
        where: { id: batch.id },
        data: { recipientCount: created.length + folded.length },
      });
      return { batchId: batch.id, created, folded, overflowed };
    });

    if (outcome.overflowed > 0) {
      this.logger.warn(
        `Source "${prepared.source.key}" is past its limit of ${this.config.floodLimit} a minute for ${outcome.overflowed} recipient(s); the surplus was folded into one row each.`,
      );
    }

    // ── after the commit ──────────────────────────────────────────────────
    const publishes: Promise<void>[] = [];
    for (const [kind, rows] of [
      ['created', outcome.created],
      ['grouped', outcome.folded],
    ] as const) {
      for (const row of rows) {
        const payload = renderNotification(row, this.config, now);
        if (payload) publishes.push(this.events.delivered(kind, row.recipientId, payload, outcome.batchId));
      }
    }
    await Promise.all(publishes);

    return {
      batchId: outcome.batchId,
      written: outcome.created.length,
      grouped: outcome.folded.length,
      overflowed: outcome.overflowed,
    };
  }

  /**
   * The compose screen's send: ALWAYS as the platform, with at most one link.
   *
   * ⚠ The recipient reads "Platform"; `actorId` is recorded on the batch for
   * the audit and never shown. Person-to-person messages are chat's job.
   */
  async sendAsPlatform(
    actorId: string,
    input: {
      recipientIds: readonly string[];
      severity?: string | null;
      title: string;
      body?: string | null;
      linkLabel?: string | null;
      linkHref?: string | null;
    },
  ): Promise<NotificationSendResult> {
    const severity = input.severity ?? 'info';
    if (!isNotificationSeverity(severity)) throw new NotificationWriteError('invalid', 'That severity does not exist.');
    const href = input.linkHref?.trim() ?? '';
    return this.send({
      recipientIds: input.recipientIds,
      severity,
      title: input.title,
      body: input.body ?? null,
      source: NOTIFICATION_PLATFORM_SOURCE.key,
      // One optional link: a person composing by hand needs one "Open" at most.
      // Its target is decided by `prepareActions` — external links always open
      // in a new tab.
      actions: href
        ? [{ kind: 'link', key: 'open', label: input.linkLabel?.trim() || 'Open', href, target: 'self' }]
        : [],
      senderId: actorId,
    });
  }

  /**
   * Sends, and never throws — for a producer reporting something that already
   * went wrong, usually from a `catch` block.
   *
   * ⚠ Reporting an error must not become a second error. A validation mistake
   * or a database failure here is LOGGED and answered with null; the code that
   * was handling the first failure carries on handling it.
   */
  async sendSafely(input: NotificationSendInput): Promise<NotificationSendResult | null> {
    try {
      return await this.send(input);
    } catch (error) {
      this.logger.error(
        `A notification from "${input.source}" could not be sent: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
