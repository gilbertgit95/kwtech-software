import { declareScope, REQUIRED_SCOPE_METADATA, withCatchUp } from '@kwtech/module-kit';
import { Inject, Optional, SetMetadata } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { noteEventFor } from '../../domain/events.js';
import { noteDisplayTitle } from '../../domain/notes.js';
import { NoteWriteError } from '../note.errors.js';
import type { NoteModuleOptions } from '../note.options.js';
import { NOTE_EVENT, type NoteEvent, type NotePubSub, NULL_NOTE_PUBSUB } from '../note.pubsub.js';
import type { NoteRevisionRow, NoteRow, NoteSummaryRow } from '../note.repository.js';
import { NOTE_LIST_VIEWS, type NoteKeyset, type NoteListView, NoteService } from '../note.service.js';
import { NOTE_OPTIONS, NOTE_PUBSUB } from '../note.tokens.js';
import { NoteWriteService } from '../note-write.service.js';
import {
  CreateNoteInputType,
  NoteEventType,
  NoteFilterInputType,
  NoteListType,
  NoteRevisionType,
  NoteSettingsInputType,
  NoteSettingsType,
  NoteSummaryType,
  NoteType,
  UpdateNoteInputType,
} from './note.types.js';

/**
 * The notes GraphQL surface.
 *
 * ## ⚠ THE SCOPE IS DECLARED ON THE CLASS, and nothing here works without it
 *
 * Every `note:*` key is WORKSPACE level. A resolver has no path, so without a
 * declaration `FeatureGuard` resolves app level — where no workspace key
 * participates — and every key grants nothing to everybody, silently (§12.13).
 * Declared on the CLASS so an operation added later cannot forget it;
 * `surface-coverage.test.ts` fails if it goes. Every operation therefore takes
 * `organizationId` and `workspaceId`.
 *
 * ## Where the guard is, since there is no decorator here
 *
 * Every operation is guarded by its BINDING in `NOTE_FEATURE_REGISTRY`. None is
 * unbound: even your own pin and your own settings write a row into the
 * workspace named in the request, and the key is what proves you belong there.
 *
 * ## And the guard is only half
 *
 * The key says you may read or write notes in this workspace. The services say
 * whether THIS note is yours to see, edit, share or bin — by id AND scope, and
 * with one answer for "no such note" and "not yours to see".
 */
@SetMetadata(REQUIRED_SCOPE_METADATA, declareScope('workspace'))
@Resolver()
export class NoteResolver {
  constructor(
    private readonly notes: NoteService,
    private readonly writes: NoteWriteService,
    @Inject(NOTE_OPTIONS) private readonly options: NoteModuleOptions,
    /** Absent means not live: `noteEvents` sends `sync` and ends. */
    @Optional() @Inject(NOTE_PUBSUB) private readonly pubsub?: NotePubSub,
  ) {}

  // ── queries ───────────────────────────────────────────────────────────────

  @Query(() => NoteListType, { name: 'notes' })
  async list(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('filter', { type: () => NoteFilterInputType, nullable: true }) filter?: NoteFilterInputType | null,
  ): Promise<NoteListType> {
    const viewerId = this.actor(gql.req);
    const result = await this.notes.list({ organizationId, workspaceId }, viewerId, {
      view: listView(filter?.view),
      search: filter?.search,
      tag: filter?.tag,
      cursor: decodeCursor(filter?.cursor),
      limit: filter?.limit,
    });

    const all = [...result.pinned, ...result.notes];
    const names = await this.notes.names(all.flatMap((note) => [note.authorId, note.updatedById]));
    const render = (note: NoteSummaryRow) => renderSummary(note, viewerId, result.pinnedIds.has(note.id), names);
    return {
      pinned: result.pinned.map(render),
      notes: result.notes.map(render),
      nextCursor: result.next ? encodeCursor(result.next) : null,
      tags: result.tags ? [...result.tags] : null,
    };
  }

  /** Null for a note that does not exist AND for one the viewer may not see — the same answer. */
  @Query(() => NoteType, { name: 'note', nullable: true })
  async note(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('noteId') noteId: string,
  ): Promise<NoteType | null> {
    const viewerId = this.actor(gql.req);
    const found = await this.notes.get({ organizationId, workspaceId }, viewerId, noteId);
    if (!found) return null;
    const names = await this.notes.names([found.note.authorId, found.note.updatedById]);
    return renderNote(found.note, viewerId, found.pinned, names);
  }

  /** Null when the note is not the viewer's to see. */
  @Query(() => [NoteRevisionType], { name: 'noteRevisions', nullable: true })
  async revisions(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('noteId') noteId: string,
  ): Promise<NoteRevisionType[] | null> {
    const rows = await this.notes.revisions({ organizationId, workspaceId }, this.actor(gql.req), noteId);
    if (!rows) return null;
    const names = await this.notes.names(rows.map((row) => row.editedById));
    return rows.map((row) => renderRevision(row, names));
  }

  @Query(() => NoteSettingsType, { name: 'myNoteSettings' })
  async settings(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): Promise<NoteSettingsType> {
    return this.notes.settings({ organizationId, workspaceId }, this.actor(gql.req));
  }

  // ── the live index ────────────────────────────────────────────────────────

  /**
   * Changes to notes the viewer can see, in this workspace.
   *
   * Bound as `graphql_subscription` to `note:read`, and the class's workspace
   * scope applies to it like any operation, so the guard runs
   * `canAccessWorkspace` at subscribe. Authorised ONCE, then bounded by the
   * socket closing when the token that opened it expires.
   *
   * ⚠ FILTERED PER SUBSCRIBER (`noteEventFor`), unlike the queue's
   * workspace-only filter: a private note's changes reach its author and
   * nobody else. Events carry ids, never content.
   *
   * ⚠ `sync` FIRST, on every (re)subscribe: the engine has no replay, so a
   * change made while the socket was reconnecting would otherwise never arrive.
   */
  @Subscription(() => NoteEventType, {
    name: 'noteEvents',
    // ⚠ REQUIRED: without it GraphQL looks for a `noteEvents` key on the
    // payload, finds none, and delivers `data: null` forever.
    resolve: (payload: NoteEventType) => payload,
  })
  noteEvents(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
  ): AsyncIterableIterator<NoteEventType> {
    // At subscribe, so a socket with nobody on it is refused now, not never.
    const viewer = { userId: this.actor(gql.req), organizationId, workspaceId };

    return withCatchUp<NoteEvent, NoteEventType>({
      live: (this.pubsub ?? NULL_NOTE_PUBSUB).asyncIterableIterator<NoteEvent>(NOTE_EVENT.changed),
      catchUp: async () => [{ kind: 'sync', noteId: null, version: null, actorId: null }],
      transform: (event) => {
        const kind = noteEventFor(event, viewer);
        if (!kind) return null;
        return { kind, noteId: event.noteId, version: event.version, actorId: event.actorId };
      },
      keyOf: () => null,
    });
  }

  // ── writing ───────────────────────────────────────────────────────────────

  @Mutation(() => NoteType, { name: 'createNote' })
  async create(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('input', { type: () => CreateNoteInputType }) input: CreateNoteInputType,
  ): Promise<NoteType> {
    const actorId = this.actor(gql.req);
    const note = await this.writes.create({ organizationId, workspaceId }, actorId, { ...input });
    return this.rendered(note, actorId, false);
  }

  /** ⚠ From `expectedVersion`. A stale save is refused with `NOTE_CONFLICT_MESSAGE`. */
  @Mutation(() => NoteType, { name: 'updateNote' })
  async update(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('noteId') noteId: string,
    @Args('expectedVersion', { type: () => Int }) expectedVersion: number,
    @Args('input', { type: () => UpdateNoteInputType }) input: UpdateNoteInputType,
  ): Promise<NoteType> {
    const actorId = this.actor(gql.req);
    const scope = { organizationId, workspaceId };
    return this.rendered(await this.writes.update(scope, actorId, noteId, expectedVersion, { ...input }), actorId);
  }

  @Mutation(() => NoteType, { name: 'restoreNoteRevision' })
  async restoreRevision(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('noteId') noteId: string,
    @Args('revisionId') revisionId: string,
    @Args('expectedVersion', { type: () => Int }) expectedVersion: number,
  ): Promise<NoteType> {
    const actorId = this.actor(gql.req);
    const scope = { organizationId, workspaceId };
    const note = await this.writes.restoreRevision(scope, actorId, noteId, revisionId, expectedVersion);
    return this.rendered(note, actorId);
  }

  /** `private` or `workspace`. The author's alone. */
  @Mutation(() => NoteType, { name: 'setNoteVisibility' })
  async setVisibility(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('noteId') noteId: string,
    @Args('visibility') visibility: string,
  ): Promise<NoteType> {
    const actorId = this.actor(gql.req);
    return this.rendered(
      await this.writes.setVisibility({ organizationId, workspaceId }, actorId, noteId, visibility),
      actorId,
    );
  }

  @Mutation(() => NoteType, { name: 'trashNote' })
  async trash(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('noteId') noteId: string,
  ): Promise<NoteType> {
    const actorId = this.actor(gql.req);
    return this.rendered(await this.writes.trash({ organizationId, workspaceId }, actorId, noteId), actorId);
  }

  @Mutation(() => NoteType, { name: 'restoreNote' })
  async restore(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('noteId') noteId: string,
  ): Promise<NoteType> {
    const actorId = this.actor(gql.req);
    return this.rendered(await this.writes.restore({ organizationId, workspaceId }, actorId, noteId), actorId);
  }

  /** Only from the trash. Not undoable. */
  @Mutation(() => Boolean, { name: 'deleteNoteForever' })
  async deleteForever(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('noteId') noteId: string,
  ): Promise<boolean> {
    await this.writes.deleteForever({ organizationId, workspaceId }, this.actor(gql.req), noteId);
    return true;
  }

  // ── the person's own rows ─────────────────────────────────────────────────

  @Mutation(() => Boolean, { name: 'setNotePinned' })
  async setPinned(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('noteId') noteId: string,
    @Args('pinned') pinned: boolean,
  ): Promise<boolean> {
    await this.writes.setPinned({ organizationId, workspaceId }, this.actor(gql.req), noteId, pinned);
    return pinned;
  }

  @Mutation(() => NoteSettingsType, { name: 'setMyNoteSettings' })
  async setSettings(
    @Context() gql: { req?: unknown },
    @Args('organizationId') organizationId: string,
    @Args('workspaceId') workspaceId: string,
    @Args('settings', { type: () => NoteSettingsInputType }) settings: NoteSettingsInputType,
  ): Promise<NoteSettingsType> {
    return this.writes.setSettings({ organizationId, workspaceId }, this.actor(gql.req), { ...settings });
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * A written note as the writer sees it, with names. `pinned` is read again
   * unless the caller knows it (a new note is never pinned).
   */
  private async rendered(note: NoteRow, actorId: string, pinned?: boolean): Promise<NoteType> {
    const scope = { organizationId: note.organizationId, workspaceId: note.workspaceId };
    const [names, found] = await Promise.all([
      this.notes.names([note.authorId, note.updatedById]),
      pinned === undefined ? this.notes.get(scope, actorId, note.id) : Promise.resolve(null),
    ]);
    return renderNote(note, actorId, pinned ?? found?.pinned ?? false, names);
  }

  private actor(request: unknown): string {
    const actorId = this.options.resolveActorId?.(request);
    if (!actorId) throw new NoteWriteError('not_permitted', 'Not signed in');
    return actorId;
  }
}

function listView(raw: string | null | undefined): NoteListView {
  return (NOTE_LIST_VIEWS as readonly unknown[]).includes(raw) ? (raw as NoteListView) : 'all';
}

function renderSummary(
  note: NoteSummaryRow,
  viewerId: string,
  pinned: boolean,
  names: ReadonlyMap<string, string>,
): NoteSummaryType {
  return {
    id: note.id,
    title: note.title,
    displayTitle: noteDisplayTitle({ title: note.title, body: note.preview }),
    preview: note.preview,
    visibility: note.visibility,
    color: note.color,
    tags: [...note.tags],
    version: note.version,
    pinned,
    mine: note.authorId === viewerId,
    authorId: note.authorId,
    authorName: names.get(note.authorId) ?? null,
    updatedById: note.updatedById,
    updatedByName: names.get(note.updatedById) ?? null,
    updatedAt: note.updatedAt.toISOString(),
    createdAt: note.createdAt.toISOString(),
    trashedAt: note.trashedAt ? note.trashedAt.toISOString() : null,
  };
}

function renderNote(note: NoteRow, viewerId: string, pinned: boolean, names: ReadonlyMap<string, string>): NoteType {
  return {
    ...renderSummary(note, viewerId, pinned, names),
    // The full body is here, so the display title reads its real first line.
    displayTitle: noteDisplayTitle(note),
    body: note.body,
  };
}

function renderRevision(row: NoteRevisionRow, names: ReadonlyMap<string, string>): NoteRevisionType {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    editedById: row.editedById,
    editedByName: names.get(row.editedById) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Opaque so a client cannot build one — a hand-made cursor is a client that has
 * learned the keyset, and the next change to the ordering breaks it silently.
 * Base64 rather than a signature: it encodes nothing secret, and the query it
 * feeds still carries the viewer's visibility, so a forged one can only page
 * their own index oddly. Chat's shape.
 */
function encodeCursor(keyset: NoteKeyset): string {
  return Buffer.from(`${keyset.updatedAt.getTime()}:${keyset.id}`).toString('base64url');
}

function decodeCursor(cursor: string | null | undefined): NoteKeyset | undefined {
  if (!cursor) return undefined;
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = raw.indexOf(':');
  if (separator < 1) return undefined;
  const at = Number(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  // A malformed cursor pages from the START rather than throwing: a stale
  // cursor is not worth an error on the screen.
  if (!Number.isFinite(at) || !id) return undefined;
  return { updatedAt: new Date(at), id };
}
