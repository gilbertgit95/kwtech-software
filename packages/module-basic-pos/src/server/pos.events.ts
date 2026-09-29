import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { NULL_POS_PUBSUB, POS_EVENT, type PosChange, type PosEvent, type PosPubSub } from './pos.pubsub.js';
import type { InScope } from './pos.repository.js';
import { POS_PUBSUB } from './pos.tokens.js';

/**
 * Announcing what just happened in a store.
 *
 * ⚠ AFTER THE COMMIT, NEVER INSIDE IT. A publish inside the transaction would
 * announce a change that a rollback then undoes.
 *
 * ⚠ AND IT MUST NOT FAIL THE WRITE. The sale was saved; the socket is an
 * enhancement. A pub/sub error that propagated would turn a saved sale into an
 * error, and the retry would ring it up again.
 */
@Injectable()
export class PosEventPublisher {
  private readonly logger = new Logger('PosEvents');

  constructor(@Optional() @Inject(POS_PUBSUB) private readonly pubsub?: PosPubSub) {}

  async changed(scope: InScope, change: PosChange, actorId: string, orderId: string | null = null): Promise<void> {
    const event: PosEvent = {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      change,
      orderId,
      actorId,
    };
    try {
      await (this.pubsub ?? NULL_POS_PUBSUB).publish(POS_EVENT.changed, event);
    } catch (error) {
      this.logger.error(`A POS event could not be published: ${(error as Error).message}`);
    }
  }
}
