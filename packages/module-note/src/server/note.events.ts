import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { NoteChange } from '../domain/events.js';
import { NOTE_EVENT, type NoteEvent, type NotePubSub, NULL_NOTE_PUBSUB } from './note.pubsub.js';
import type { NoteRow } from './note.repository.js';
import { NOTE_PUBSUB } from './note.tokens.js';

/**
 * Announcing what just happened to a note.
 *
 * ⚠ AFTER THE COMMIT, NEVER INSIDE IT. A publish inside the transaction would
 * announce a save that a rollback then undoes, and every open copy would read
 * the note again for nothing — or worse, see the rolled-back version first.
 *
 * ⚠ AND IT MUST NOT FAIL THE WRITE. The note was saved; the socket is an
 * enhancement. A pub/sub error that propagated would turn a saved note into an
 * error, and the retry would conflict with the save that already landed.
 */
@Injectable()
export class NoteEventPublisher {
  private readonly logger = new Logger('NoteEvents');

  constructor(@Optional() @Inject(NOTE_PUBSUB) private readonly pubsub?: NotePubSub) {}

  /**
   * @param note the row AFTER the change — its visibility is what the filter
   * reads. For a deletion, the row as it was, with `version` passed as null.
   */
  async noteChanged(note: NoteRow, change: NoteChange, actorId: string): Promise<void> {
    const event: NoteEvent = {
      organizationId: note.organizationId,
      workspaceId: note.workspaceId,
      noteId: note.id,
      authorId: note.authorId,
      visibility: note.visibility,
      change,
      version: change === 'deleted' ? null : note.version,
      actorId,
    };
    try {
      await (this.pubsub ?? NULL_NOTE_PUBSUB).publish(NOTE_EVENT.changed, event);
    } catch (error) {
      this.logger.error(`A note event could not be published: ${(error as Error).message}`);
    }
  }
}
