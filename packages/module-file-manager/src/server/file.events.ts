import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { FILE_EVENT, type FileEvent, type FilePubSub, NULL_FILE_PUBSUB } from './file.pubsub.js';
import { FILE_PUBSUB } from './file.tokens.js';

/**
 * Announcing what just happened to a workspace's files.
 *
 * ⚠ AFTER THE COMMIT, NEVER INSIDE IT, and it never fails the write: the
 * change was saved, and the socket is an enhancement.
 */
@Injectable()
export class FileEventPublisher {
  private readonly logger = new Logger('FileEvents');

  constructor(@Optional() @Inject(FILE_PUBSUB) private readonly pubsub?: FilePubSub) {}

  async publish(event: FileEvent): Promise<void> {
    try {
      await (this.pubsub ?? NULL_FILE_PUBSUB).publish(FILE_EVENT.changed, event);
    } catch (error) {
      this.logger.error(`A file event could not be published: ${(error as Error).message}`);
    }
  }
}
