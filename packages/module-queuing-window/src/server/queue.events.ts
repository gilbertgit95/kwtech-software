import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  NULL_QUEUE_PUBSUB,
  QUEUE_EVENT,
  type QueueCallChange,
  type QueueEvent,
  type QueuePubSub,
  type QueueSessionChange,
  type QueueWorkspaceChange,
  toTicketPayload,
} from './queue.pubsub.js';
import type { SessionRow, TicketRow } from './queue.repository.js';
import type { QueueScope } from './queue.service.js';
import { QUEUE_PUBSUB } from './queue.tokens.js';

/**
 * Announcing what just happened in a workspace's queue.
 *
 * ⚠ AFTER THE COMMIT, NEVER INSIDE IT. A publish inside the transaction would
 * announce a call that a rollback — including the allocator's own retry — then
 * undoes, and a TV would already have chimed for it. The write service returns
 * from `$transaction` first and calls in here second.
 *
 * ⚠ AND IT MUST NOT FAIL THE WRITE. The number was called; the socket is an
 * enhancement. A pub/sub error that propagated would turn a completed call into
 * an error and a retry, and the retry would call the NEXT number.
 */
@Injectable()
export class QueueEventPublisher {
  private readonly logger = new Logger('QueueEvents');

  constructor(@Optional() @Inject(QUEUE_PUBSUB) private readonly pubsub?: QueuePubSub) {}

  async ticketChanged(ticket: TicketRow, change: QueueCallChange): Promise<void> {
    await this.publish(QUEUE_EVENT.call, {
      kind: 'call',
      organizationId: ticket.organizationId,
      workspaceId: ticket.workspaceId,
      sessionId: ticket.sessionId,
      change,
      ticket: toTicketPayload(ticket),
    });
  }

  async sessionChanged(session: SessionRow, change: QueueSessionChange): Promise<void> {
    await this.publish(QUEUE_EVENT.session, {
      kind: 'session',
      organizationId: session.organizationId,
      workspaceId: session.workspaceId,
      sessionId: session.id,
      change,
    });
  }

  async workspaceChanged(scope: QueueScope, change: QueueWorkspaceChange): Promise<void> {
    await this.publish(QUEUE_EVENT.workspace, {
      kind: 'workspace',
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      change,
    });
  }

  private async publish(trigger: string, event: QueueEvent): Promise<void> {
    try {
      await (this.pubsub ?? NULL_QUEUE_PUBSUB).publish(trigger, event);
    } catch (error) {
      this.logger.error(`A queue event could not be published: ${(error as Error).message}`);
    }
  }
}
