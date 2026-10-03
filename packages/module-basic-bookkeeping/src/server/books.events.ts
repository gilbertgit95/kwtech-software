import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { BOOKS_EVENT, type BooksEvent, type BooksPubSub, NULL_BOOKS_PUBSUB } from './books.pubsub.js';
import type { InScope } from './books.repository.js';
import { BOOKS_PUBSUB } from './books.tokens.js';

/**
 * Announcing that the books changed.
 *
 * ⚠ AFTER THE COMMIT, NEVER INSIDE IT. A publish inside the transaction would
 * announce a change that a rollback then undoes.
 *
 * ⚠ AND IT MUST NOT FAIL THE WRITE. The payout was recorded; the socket is an
 * enhancement. A pub/sub error that propagated would turn a recorded payout
 * into an error, and the retry would record it again.
 */
@Injectable()
export class BooksEventPublisher {
  private readonly logger = new Logger('BooksEvents');

  constructor(@Optional() @Inject(BOOKS_PUBSUB) private readonly pubsub?: BooksPubSub) {}

  async changed(scope: InScope, actorId: string): Promise<void> {
    const event: BooksEvent = {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      change: 'books',
      actorId,
    };
    try {
      await (this.pubsub ?? NULL_BOOKS_PUBSUB).publish(BOOKS_EVENT.changed, event);
    } catch (error) {
      this.logger.error(`A books event could not be published: ${(error as Error).message}`);
    }
  }
}
