/**
 * The shapes the domain decides over. Plain data, no framework, so the server
 * half and the web half hold the same rules.
 */

/**
 * Who may see a note.
 *
 *   private   — its author, and nobody else, whatever keys they hold.
 *   workspace — every member of the workspace holding `note:read`.
 */
export type NoteVisibility = 'private' | 'workspace';

/** The facts every access decision needs, and no more. */
export interface NoteAccessFacts {
  authorId: string;
  visibility: NoteVisibility;
  /** When it went in the trash. Null while it is live. */
  trashedAt: Date | null;
}

/**
 * Why a note operation was refused. One union for the module, carried by its
 * one error class at the service boundary.
 *
 * ⚠ `not_found` ALSO MEANS "somebody else's private note" and "a note in
 * another workspace". Answering those differently would let anyone probe ids
 * and learn that a private note exists (NOTE-PLAN §5).
 */
export type NoteRefusal =
  | 'not_found'
  | 'not_permitted'
  | 'not_author'
  | 'in_trash'
  | 'not_in_trash'
  | 'conflict'
  | 'limit_reached'
  | 'invalid_title'
  | 'invalid_body'
  | 'invalid_tags'
  | 'invalid_color'
  | 'invalid_settings';
