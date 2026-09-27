'use client';

import type { NoteSettings } from '../domain/appearance.js';
import { NOTE_OPERATIONS } from '../operations.js';

/**
 * How the notes app reaches the API — through the app's same-origin route
 * handler, which attaches the session. The path is a parameter because that
 * handler belongs to `module-auth`, and this module may not name its URL
 * (PLAN §9). The default is where this app mounts it.
 */
export const DEFAULT_GRAPHQL_PATH = '/api/auth/graphql';

export interface NoteScopeView {
  organizationId: string;
  workspaceId: string;
}

/** A note as the index shows it. No body — see `preview`. */
export interface NoteSummaryView {
  id: string;
  title: string;
  displayTitle: string;
  preview: string;
  /** `private` or `workspace`. */
  visibility: string;
  color: string;
  tags: string[];
  version: number;
  pinned: boolean;
  mine: boolean;
  authorId: string;
  authorName: string | null;
  updatedById: string;
  updatedByName: string | null;
  updatedAt: string;
  createdAt: string;
  trashedAt: string | null;
}

export interface NoteView extends NoteSummaryView {
  body: string;
}

export interface NoteListView {
  pinned: NoteSummaryView[];
  notes: NoteSummaryView[];
  nextCursor: string | null;
  tags: string[] | null;
}

export interface NoteRevisionView {
  id: string;
  title: string;
  body: string;
  editedById: string;
  editedByName: string | null;
  createdAt: string;
}

/** `all`, `mine`, `shared` or `trash`. */
export type NoteTab = 'all' | 'mine' | 'shared' | 'trash';

export interface NoteFilterView {
  view: NoteTab;
  search?: string | null;
  tag?: string | null;
  cursor?: string | null;
  limit?: number | null;
}

export interface NoteEditInput {
  title?: string;
  body?: string;
  color?: string;
  tags?: readonly string[];
}

export interface NoteClient {
  list(scope: NoteScopeView, filter: NoteFilterView): Promise<NoteListView>;
  /** Null for a note that does not exist and one not shared with you alike. */
  get(scope: NoteScopeView, noteId: string): Promise<NoteView | null>;
  revisions(scope: NoteScopeView, noteId: string): Promise<NoteRevisionView[] | null>;
  settings(scope: NoteScopeView): Promise<NoteSettings>;
  create(scope: NoteScopeView, input: NoteEditInput & { visibility?: string }): Promise<NoteView>;
  /** ⚠ Only the changed fields, from the version they were changed from. */
  update(
    scope: NoteScopeView,
    noteId: string,
    expectedVersion: number,
    input: NoteEditInput,
    options?: { keepalive?: boolean },
  ): Promise<NoteView>;
  restoreRevision(scope: NoteScopeView, noteId: string, revisionId: string, expectedVersion: number): Promise<NoteView>;
  setVisibility(scope: NoteScopeView, noteId: string, visibility: 'private' | 'workspace'): Promise<NoteView>;
  trash(scope: NoteScopeView, noteId: string): Promise<NoteView>;
  restore(scope: NoteScopeView, noteId: string): Promise<NoteView>;
  deleteForever(scope: NoteScopeView, noteId: string): Promise<void>;
  setPinned(scope: NoteScopeView, noteId: string, pinned: boolean): Promise<void>;
  setSettings(scope: NoteScopeView, settings: NoteSettings): Promise<NoteSettings>;
}

export function createNoteClient(options: { graphqlPath?: string } = {}): NoteClient {
  const path = options.graphqlPath ?? DEFAULT_GRAPHQL_PATH;

  /**
   * One request shape for every call. Throws the API's FIRST error message:
   * the refusals are written for a reader, and two of them — not found and
   * conflict — are what the editor compares against (`saveFailure`).
   *
   * `keepalive` lets the last save of a closing tab finish after the page is
   * gone. Browsers cap such a body at 64 KB, so it is best effort, and the
   * editor also warns before the page closes with a save pending.
   */
  async function graphql<T>(document: string, variables: Record<string, unknown>, keepalive = false): Promise<T> {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ query: document, variables }),
      cache: 'no-store',
      keepalive,
    });
    if (!response.ok) {
      throw new Error(response.status === 401 ? 'Your session has ended. Sign in again.' : 'Cannot reach the server.');
    }
    const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'The request was refused.');
    if (!body.data) throw new Error('The server returned no data.');
    return body.data;
  }

  const scoped = (scope: NoteScopeView, extra: Record<string, unknown> = {}) => ({
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    ...extra,
  });
  const ops = NOTE_OPERATIONS;

  return {
    async list(scope, filter) {
      return (await graphql<{ notes: NoteListView }>(ops.notes, scoped(scope, { filter }))).notes;
    },
    async get(scope, noteId) {
      return (await graphql<{ note: NoteView | null }>(ops.note, scoped(scope, { noteId }))).note;
    },
    async revisions(scope, noteId) {
      return (await graphql<{ noteRevisions: NoteRevisionView[] | null }>(ops.noteRevisions, scoped(scope, { noteId })))
        .noteRevisions;
    },
    async settings(scope) {
      return (await graphql<{ myNoteSettings: NoteSettings }>(ops.myNoteSettings, scoped(scope))).myNoteSettings;
    },
    async create(scope, input) {
      return (await graphql<{ createNote: NoteView }>(ops.createNote, scoped(scope, { input }))).createNote;
    },
    async update(scope, noteId, expectedVersion, input, options = {}) {
      const variables = scoped(scope, { noteId, expectedVersion, input });
      return (await graphql<{ updateNote: NoteView }>(ops.updateNote, variables, options.keepalive ?? false))
        .updateNote;
    },
    async restoreRevision(scope, noteId, revisionId, expectedVersion) {
      const variables = scoped(scope, { noteId, revisionId, expectedVersion });
      return (await graphql<{ restoreNoteRevision: NoteView }>(ops.restoreNoteRevision, variables)).restoreNoteRevision;
    },
    async setVisibility(scope, noteId, visibility) {
      return (
        await graphql<{ setNoteVisibility: NoteView }>(ops.setNoteVisibility, scoped(scope, { noteId, visibility }))
      ).setNoteVisibility;
    },
    async trash(scope, noteId) {
      return (await graphql<{ trashNote: NoteView }>(ops.trashNote, scoped(scope, { noteId }))).trashNote;
    },
    async restore(scope, noteId) {
      return (await graphql<{ restoreNote: NoteView }>(ops.restoreNote, scoped(scope, { noteId }))).restoreNote;
    },
    async deleteForever(scope, noteId) {
      await graphql<{ deleteNoteForever: boolean }>(ops.deleteNoteForever, scoped(scope, { noteId }));
    },
    async setPinned(scope, noteId, pinned) {
      await graphql<{ setNotePinned: boolean }>(ops.setNotePinned, scoped(scope, { noteId, pinned }));
    },
    async setSettings(scope, settings) {
      return (await graphql<{ setMyNoteSettings: NoteSettings }>(ops.setMyNoteSettings, scoped(scope, { settings })))
        .setMyNoteSettings;
    },
  };
}
