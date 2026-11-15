import type { Readable } from 'node:stream';

/**
 * The questions this module cannot answer itself, as structural ports the APP
 * fills (PLAN §9). Each absence has a documented meaning (`file.tokens.ts`).
 */

/** One stored file, as the store knows it: by key, with no name and no owner. */
export interface FileStoreEntry {
  storageKey: string;
  /** An upload still arriving, or one that died: never a file anybody can download. */
  partial: boolean;
  /** When it was last written, so the clean-up never removes an upload still arriving. */
  modifiedAt: Date;
}

export type FileStoreWrite = { kind: 'stored'; sizeBytes: number } | { kind: 'too_large' };

/**
 * Where the bytes of a file live: a folder today (`createFolderFileStore`), a
 * blob server later (issue #138). ⚠ THE ONLY THING THAT CHANGES WHEN BLOB
 * STORAGE ARRIVES is the store the app binds; nothing else here knows where
 * the bytes are.
 *
 * Keys arrive checked (`isFileStorageKey`), and `workspaceId` is a cuid; the
 * store still refuses either if it would leave its root, because a port is a
 * boundary of its own.
 */
export interface FileStore {
  /**
   * Writes `source` under `storageKey`, stopping as soon as it passes
   * `maxBytes`. ⚠ Under a temporary name until the last byte has arrived, so
   * a cut-off upload is never a file, and removed on any failure.
   */
  write(workspaceId: string, storageKey: string, source: Readable, maxBytes: number): Promise<FileStoreWrite>;
  /** The bytes to stream to a download, or null when they are not there. */
  open(workspaceId: string, storageKey: string): Promise<{ stream: Readable; sizeBytes: number } | null>;
  /** Removes one, finished or partial. Quietly done when it was not there. */
  remove(workspaceId: string, storageKey: string): Promise<void>;
  /** Everything stored for one workspace, unfinished uploads included, for the clean-up's stray sweep. */
  list(workspaceId: string): Promise<readonly FileStoreEntry[]>;
}

export interface FileMember {
  userId: string;
  displayName: string;
}

/**
 * Who works here: the people a file may be shared with, and names.
 *
 * `listShareable` is ACTIVE members of the workspace who hold `file:read`
 * there — somebody who cannot open the app could not see a file shared with
 * them. `describe` names anybody, former members included; an id it does not
 * know is left out.
 */
export interface FileMemberDirectory {
  listShareable(organizationId: string, workspaceId: string): Promise<readonly FileMember[]>;
  describe(userIds: readonly string[]): Promise<readonly FileMember[]>;
}

/**
 * Telling people about files, in the MODULE's words; the app chooses the
 * wording, severity and source (`module-notification`'s recipe).
 *
 * ⚠ CALLED AFTER THE COMMIT, and its failure never fails the write. The
 * recipients never include the person who acted.
 */
export interface FileNotifier {
  shared(event: FileSharedNotice): Promise<void>;
}

export interface FileSharedNotice {
  recipientIds: readonly string[];
  actorId: string;
  organizationId: string;
  workspaceId: string;
  fileId: string;
  fileName: string;
}
