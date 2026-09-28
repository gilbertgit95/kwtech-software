import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { TaskChange } from '../domain/events.js';
import { NULL_TASK_PUBSUB, TASK_EVENT, type TaskEvent, type TaskPubSub } from './task.pubsub.js';
import type { TaskBoardRow } from './task.repository.js';
import { TASK_PUBSUB } from './task.tokens.js';

/**
 * Announcing what just happened on a board.
 *
 * ⚠ AFTER THE COMMIT, NEVER INSIDE IT. A publish inside the transaction would
 * announce a change that a rollback then undoes.
 *
 * ⚠ AND IT MUST NOT FAIL THE WRITE. The change was saved; the socket is an
 * enhancement. A pub/sub error that propagated would turn a saved change into an
 * error, and the retry would repeat it.
 */
@Injectable()
export class TaskEventPublisher {
  private readonly logger = new Logger('TaskEvents');

  constructor(@Optional() @Inject(TASK_PUBSUB) private readonly pubsub?: TaskPubSub) {}

  /** @param board the board AFTER the change — its kind is what the filter reads. */
  async changed(board: TaskBoardRow, change: TaskChange, actorId: string, taskId: string | null = null): Promise<void> {
    const event: TaskEvent = {
      organizationId: board.organizationId,
      workspaceId: board.workspaceId,
      boardId: board.id,
      ownerId: board.ownerId,
      visibility: board.visibility,
      change,
      taskId,
      actorId,
    };
    try {
      await (this.pubsub ?? NULL_TASK_PUBSUB).publish(TASK_EVENT.changed, event);
    } catch (error) {
      this.logger.error(`A task event could not be published: ${(error as Error).message}`);
    }
  }
}
