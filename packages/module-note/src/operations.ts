/**
 * Every GraphQL document this module sends, as data.
 *
 * A document is the ONE part of a typed client that nothing typechecks: a
 * renamed field or a moved argument is a runtime refusal on a screen. Lifted out
 * here, the host hands every one of them to `graphql`'s own validator against
 * the schema it serves — `apps/web-server/test/module-operations.test.ts`.
 *
 * ⚠ FRAMEWORK-FREE, and exported from the package ROOT rather than `/react`, so
 * a server validating them never resolves React to read a string.
 */

const SUMMARY =
  'id title displayTitle preview visibility color tags version pinned mine authorId authorName updatedById updatedByName updatedAt createdAt trashedAt';
const NOTE = `${SUMMARY} body`;
const SETTINGS = 'look font defaultColor';
const SCOPE_VARS = '$organizationId: String!, $workspaceId: String!';
const SCOPE_ARGS = 'organizationId: $organizationId, workspaceId: $workspaceId';

export const NOTE_OPERATIONS = {
  /** The index: pinned notes, a page of the rest, and — on the first page — the tags. */
  notes: `query Notes(${SCOPE_VARS}, $filter: NoteFilterInput) {
    notes(${SCOPE_ARGS}, filter: $filter) {
      pinned { ${SUMMARY} }
      notes { ${SUMMARY} }
      nextCursor
      tags
    }
  }`,

  /** Null for a note that does not exist and for one that is not shared with you alike. */
  note: `query Note(${SCOPE_VARS}, $noteId: String!) {
    note(${SCOPE_ARGS}, noteId: $noteId) { ${NOTE} }
  }`,

  noteRevisions: `query NoteRevisions(${SCOPE_VARS}, $noteId: String!) {
    noteRevisions(${SCOPE_ARGS}, noteId: $noteId) { id title body editedById editedByName createdAt }
  }`,

  myNoteSettings: `query MyNoteSettings(${SCOPE_VARS}) {
    myNoteSettings(${SCOPE_ARGS}) { ${SETTINGS} }
  }`,

  /**
   * The index's stream. `sync` arrives first on every (re)subscribe and the app
   * reads the index again on it; `changed` and `removed` name one note.
   */
  noteEvents: `subscription NoteEvents(${SCOPE_VARS}) {
    noteEvents(${SCOPE_ARGS}) { kind noteId version actorId }
  }`,

  createNote: `mutation CreateNote(${SCOPE_VARS}, $input: CreateNoteInput!) {
    createNote(${SCOPE_ARGS}, input: $input) { ${NOTE} }
  }`,

  /** ⚠ Send only the fields that changed, and the version they were changed from. */
  updateNote: `mutation UpdateNote(${SCOPE_VARS}, $noteId: String!, $expectedVersion: Int!, $input: UpdateNoteInput!) {
    updateNote(${SCOPE_ARGS}, noteId: $noteId, expectedVersion: $expectedVersion, input: $input) { ${NOTE} }
  }`,

  restoreNoteRevision: `mutation RestoreNoteRevision(${SCOPE_VARS}, $noteId: String!, $revisionId: String!, $expectedVersion: Int!) {
    restoreNoteRevision(${SCOPE_ARGS}, noteId: $noteId, revisionId: $revisionId, expectedVersion: $expectedVersion) { ${NOTE} }
  }`,

  setNoteVisibility: `mutation SetNoteVisibility(${SCOPE_VARS}, $noteId: String!, $visibility: String!) {
    setNoteVisibility(${SCOPE_ARGS}, noteId: $noteId, visibility: $visibility) { ${NOTE} }
  }`,

  trashNote: `mutation TrashNote(${SCOPE_VARS}, $noteId: String!) {
    trashNote(${SCOPE_ARGS}, noteId: $noteId) { ${NOTE} }
  }`,

  restoreNote: `mutation RestoreNote(${SCOPE_VARS}, $noteId: String!) {
    restoreNote(${SCOPE_ARGS}, noteId: $noteId) { ${NOTE} }
  }`,

  deleteNoteForever: `mutation DeleteNoteForever(${SCOPE_VARS}, $noteId: String!) {
    deleteNoteForever(${SCOPE_ARGS}, noteId: $noteId)
  }`,

  setNotePinned: `mutation SetNotePinned(${SCOPE_VARS}, $noteId: String!, $pinned: Boolean!) {
    setNotePinned(${SCOPE_ARGS}, noteId: $noteId, pinned: $pinned)
  }`,

  setMyNoteSettings: `mutation SetMyNoteSettings(${SCOPE_VARS}, $settings: NoteSettingsInput!) {
    setMyNoteSettings(${SCOPE_ARGS}, settings: $settings) { ${SETTINGS} }
  }`,
} as const;
