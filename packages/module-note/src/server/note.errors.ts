import { NOTE_CONFLICT_MESSAGE, NOTE_NOT_FOUND_MESSAGE, NOTE_TITLE_MAX } from '../domain/notes.js';
import { NOTE_TAG_MAX, NOTE_TAGS_MAX } from '../domain/tags.js';
import type { NoteRefusal } from '../types.js';

/**
 * One error type for every refusal a note operation makes.
 *
 * A REASON CODE, not a message: the transport decides the wording's fate, and a
 * caller that has to regex a sentence gets it wrong on the first rewording.
 *
 * ⚠ The app sees only the MESSAGE (`formatError` strips `extensions` in
 * production), so the refusals it must act on — not found, conflict — carry the
 * exact messages exported from the domain, and it compares those.
 */
export class NoteWriteError extends Error {
  constructor(
    readonly reason: NoteRefusal,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'NoteWriteError';
  }
}

/**
 * ⚠ ONE MESSAGE for a note that does not exist, is in another workspace, or is
 * somebody else's private note. Any difference — even in wording — tells a
 * prober which of the three it hit.
 */
export function noteNotFound(): NoteWriteError {
  return new NoteWriteError('not_found', NOTE_NOT_FOUND_MESSAGE);
}

/** The sentence for each refusal a domain check can return. */
export function refusalError(reason: NoteRefusal): NoteWriteError {
  return new NoteWriteError(reason, REFUSAL_MESSAGES[reason]);
}

const REFUSAL_MESSAGES: Record<NoteRefusal, string> = {
  not_found: NOTE_NOT_FOUND_MESSAGE,
  not_permitted: 'You cannot do that to somebody else’s note',
  not_author: 'Only the person who wrote this note can change who sees it',
  in_trash: 'That note is in the trash — restore it first',
  not_in_trash: 'Only a note in the trash can be deleted forever or restored',
  conflict: NOTE_CONFLICT_MESSAGE,
  limit_reached: 'You have reached the most notes you can keep here',
  invalid_title: `A title can be at most ${NOTE_TITLE_MAX} characters, with no invisible formatting`,
  invalid_body: 'That note is too long to save',
  invalid_tags: `A note can have at most ${NOTE_TAGS_MAX} tags of at most ${NOTE_TAG_MAX} characters each`,
  invalid_color: 'That is not one of the note colours',
  invalid_visibility: 'A note is either private or shared with the workspace',
  invalid_settings: 'Those appearance settings are not ones on offer',
};
