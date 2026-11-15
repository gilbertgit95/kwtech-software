import type { FileAudience } from '../types.js';
import { canSeeFile } from './files.js';

/**
 * Who hears about a change to a file (`file.changed`).
 *
 * ⚠ PER SUBSCRIBER, not per workspace: a private file's events would tell the
 * workspace it exists and when its owner works with it. So every subscriber
 * runs this over every event, with the SAME `canSeeFile` every read uses.
 *
 * An event carries the audience BEFORE and AFTER the change, so the people who
 * just LOST a file (it was made private, or deleted) are told too, and their
 * list drops it at once.
 */
export interface FileEventFacts {
  organizationId: string;
  workspaceId: string;
  /**
   *   file     — one file was uploaded, re-shared or deleted
   *   settings — how long files are kept changed: everybody's deletion times moved
   *   cleanup  — the nightly clean-up deleted files
   * The last two concern no one file and reach everybody in the workspace.
   */
  change: FileChange;
  /** Null for an upload: nobody could see it before. */
  before: FileAudience | null;
  /** Null for a deletion: nobody can see it after. */
  after: FileAudience | null;
}

export type FileChange = 'file' | 'settings' | 'cleanup';

export interface FileEventViewer {
  userId: string;
  organizationId: string;
  workspaceId: string;
}

/** True when the viewer should read their list again. */
export function fileEventReaches(event: FileEventFacts, viewer: FileEventViewer): boolean {
  if (event.organizationId !== viewer.organizationId || event.workspaceId !== viewer.workspaceId) return false;
  // ⚠ Neither says anything about a file: a list re-read through the guarded query shows only what it may.
  if (event.change !== 'file') return true;
  return (
    (event.before !== null && canSeeFile(event.before, viewer.userId)) ||
    (event.after !== null && canSeeFile(event.after, viewer.userId))
  );
}
