/**
 * The shapes the file manager's halves share. Plain data: no framework.
 */

/** Who may see a file besides its owner (prisma/file.prisma, `FileVisibility`). */
export type FileVisibility = 'private' | 'workspace' | 'people';

export const FILE_VISIBILITIES: readonly FileVisibility[] = ['private', 'workspace', 'people'];

/** The facts an access decision reads about one file. */
export interface FileAudience {
  ownerId: string;
  visibility: FileVisibility;
  /** The people a `people` file is shared with. Ignored for the other two. */
  sharedWith: readonly string[];
}

/**
 * Every reason a file operation is refused. One union, mapped to one sentence
 * each in `fileRefusalMessage`, so the server, the web app's route handlers and
 * the page all say the same thing.
 */
export type FileRefusal =
  /** No such file, another workspace's, or one not shared with you: ONE answer for all three. */
  | 'not_found'
  | 'not_owner'
  | 'not_permitted'
  | 'invalid_name'
  | 'invalid_size'
  | 'invalid_visibility'
  | 'invalid_people'
  | 'too_many_people'
  | 'not_shareable'
  | 'invalid_retention'
  /** A file larger than the plan allows one file to be. */
  | 'file_too_large'
  /** The workspace's files would take more room than the plan allows. */
  | 'storage_full'
  /** The upload sent more, or less, than it declared. */
  | 'size_mismatch'
  /** A ticket unknown, spent or expired: ONE answer for all three. */
  | 'ticket_invalid'
  /** The person already holds FILE_TICKETS_PER_PERSON_MAX live tickets: they clear within minutes. */
  | 'too_many_transfers'
  /** The app bound no store: files are not set up on this server. */
  | 'not_configured';
