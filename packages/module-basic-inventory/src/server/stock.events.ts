import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { StockChangeListener } from './ports.js';
import { NULL_STOCK_PUBSUB, STOCK_EVENT, type StockChange, type StockEvent, type StockPubSub } from './stock.pubsub.js';
import type { InScope } from './stock.repository.js';
import { STOCK_CHANGE_LISTENER, STOCK_PUBSUB } from './stock.tokens.js';

/**
 * Announcing that stock changed, to the stock app's screens and — when on hand
 * moved — to the till, through the change listener.
 *
 * ⚠ AFTER THE COMMIT, NEVER INSIDE IT. A publish inside the transaction would
 * announce a change that a rollback then undoes.
 *
 * ⚠ AND IT MUST NOT FAIL THE WRITE. The delivery was recorded; the socket is an
 * enhancement. An error that propagated would turn a recorded delivery into an
 * error, and the retry would be refused as a double press at best.
 */
@Injectable()
export class StockEventPublisher {
  private readonly logger = new Logger('StockEvents');

  constructor(
    @Optional() @Inject(STOCK_PUBSUB) private readonly pubsub?: StockPubSub,
    @Optional() @Inject(STOCK_CHANGE_LISTENER) private readonly listener?: StockChangeListener,
  ) {}

  async changed(scope: InScope, change: StockChange, actorId: string | null): Promise<void> {
    const event: StockEvent = { organizationId: scope.organizationId, workspaceId: scope.workspaceId, change, actorId };
    try {
      await (this.pubsub ?? NULL_STOCK_PUBSUB).publish(STOCK_EVENT.changed, event);
    } catch (error) {
      this.logger.error(`A stock event could not be published: ${(error as Error).message}`);
    }
    if (change !== 'stock' || !this.listener) return;
    try {
      await this.listener.stockChanged(scope.organizationId, scope.workspaceId);
    } catch (error) {
      this.logger.error(`The till could not be told that stock changed: ${(error as Error).message}`);
    }
  }
}
