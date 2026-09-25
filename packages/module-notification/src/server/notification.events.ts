import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  NOTIFICATION_EVENT,
  type NotificationChange,
  type NotificationEvent,
  type NotificationPubSub,
  NULL_NOTIFICATION_PUBSUB,
} from './notification.pubsub.js';
import type { NotificationPayload } from './notification.render.js';
import { NOTIFICATION_PUBSUB } from './notification.tokens.js';

/**
 * Announcing what just happened to somebody's notifications.
 *
 * ⚠ AFTER THE COMMIT, NEVER INSIDE IT. A publish inside the transaction would
 * toast a notification that a rollback then undoes; publishing after means a
 * tab never receives an item that re-reading cannot find.
 *
 * ⚠ AND IT MUST NOT FAIL THE WRITE. The row is committed, and the reconnect
 * catch-up delivers it to anybody the publish missed. A pub/sub error that
 * propagated would turn a delivered notification into a failed send — and a
 * producer reporting an error would then have a second error to report.
 */
@Injectable()
export class NotificationEventPublisher {
  private readonly logger = new Logger('NotificationEvents');

  constructor(@Optional() @Inject(NOTIFICATION_PUBSUB) private readonly pubsub?: NotificationPubSub) {}

  /** A new or folded notification — the event that becomes a toast. */
  async delivered(
    kind: 'created' | 'grouped',
    recipientId: string,
    notification: NotificationPayload,
    batchId: string,
  ) {
    await this.publish({ kind, recipientId, ids: [notification.id], batchId, notification });
  }

  /** Read, unread, archived, unarchived or recalled: the client re-reads. */
  async changed(kind: Exclude<NotificationChange, 'created' | 'grouped'>, recipientId: string, ids: string[]) {
    await this.publish({ kind, recipientId, ids, batchId: null, notification: null });
  }

  private async publish(event: NotificationEvent): Promise<void> {
    const started = Date.now();
    try {
      await (this.pubsub ?? NULL_NOTIFICATION_PUBSUB).publish(NOTIFICATION_EVENT.item, event);
    } catch (error) {
      this.logger.error(`A notification event could not be published: ${(error as Error).message}`);
      return;
    }
    /*
     * The latency the person feels is mostly this call. Measured rather than
     * assumed, and warned about above half a second — slow enough that "it
     * appeared immediately" stops being true.
     */
    const took = Date.now() - started;
    if (took > 500) this.logger.warn(`Publishing a notification event took ${took} ms.`);
  }
}
