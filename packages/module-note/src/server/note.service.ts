import { Inject, Injectable, Optional } from '@nestjs/common';
import { canSeeNote } from '../domain/access.js';
import { type NoteSettings, normalizeNoteSettings } from '../domain/appearance.js';
import { NOTE_ORDER_MAX, orderNotes } from '../domain/order.js';
import { escapeLikePattern, prepareNoteSearch } from '../domain/search.js';
import { normalizeNoteTag } from '../domain/tags.js';
import type {
  NoteListCondition,
  NoteListWhere,
  NotePrismaClient,
  NoteRevisionRow,
  NoteRow,
  NoteSummaryRow,
} from './note.repository.js';
import { NOTE_AUTHOR_DIRECTORY, NOTE_PRISMA } from './note.tokens.js';
import type { NoteAuthorDirectory } from './ports.js';

/** Which workspace, always both ids — every row carries both (see the schema). */
export interface NoteScope {
  organizationId: string;
  workspaceId: string;
}

/**
 * The index's tabs.
 *
 *   all    — every live note the viewer can see
 *   mine   — live notes they wrote, private or shared
 *   shared — live notes shared with the workspace, anyone's
 *   trash  — binned notes they can see: their own, and shared ones
 */
export const NOTE_LIST_VIEWS = ['all', 'mine', 'shared', 'trash'] as const;
export type NoteListView = (typeof NOTE_LIST_VIEWS)[number];

/** A page of the index. The page size is capped whatever is asked for. */
export const NOTE_PAGE_MAX = 100;
export const NOTE_PAGE_DEFAULT = 50;

/** Pinned notes shown above the list. Pins are few by nature; this only bounds a strange one. */
export const NOTE_PINNED_MAX = 50;

/**
 * How many of the most recently changed notes the tag list is drawn from.
 *
 * ⚠ A BOUND, NOT A GUARANTEE. Tags are labels on notes with no table of their
 * own (NOTE-PLAN decision 9), so listing them means reading notes. A tag only on
 * notes older than this does not appear in the filter — it still matches when
 * searched for. Named here rather than hidden; a tag table is the fix, and it
 * would bring back the leak it was dropped for.
 */
export const NOTE_TAG_SCAN_MAX = 1000;

export interface NoteListInput {
  view: NoteListView;
  search?: string | null | undefined;
  tag?: string | null | undefined;
  /** The id of the last note of the previous page. */
  after?: string | undefined;
  limit?: number | null | undefined;
}

export interface NoteListResult {
  /** The viewer's pinned notes matching the filter. Only on the first page, and never in the trash. */
  pinned: readonly NoteSummaryRow[];
  notes: readonly NoteSummaryRow[];
  /** The id the next page starts after, or null at the end. */
  next: string | null;
  /** The tags on notes the viewer can see. Only on the first page; null after it. */
  tags: readonly string[] | null;
  pinnedIds: ReadonlySet<string>;
}

/** Newest first, then by id — the order an unplaced note takes, and what the scan keeps when it truncates. */
const NEWEST = [{ createdAt: 'desc' }, { id: 'desc' }] as const;

/**
 * Reading notes. Every query here starts from WHO MAY SEE WHAT: the viewer's own
 * notes and shared ones, in this workspace of this organization. There is no
 * read in this service without it.
 */
@Injectable()
export class NoteService {
  constructor(
    @Inject(NOTE_PRISMA) private readonly prisma: NotePrismaClient,
    @Optional() @Inject(NOTE_AUTHOR_DIRECTORY) private readonly directory?: NoteAuthorDirectory,
  ) {}

  /**
   * The index, in the VIEWER'S OWN ORDER (`orderNotes`) — or, in the trash, most
   * recently binned first.
   *
   * ⚠ ORDERED IN MEMORY. The order lives on the viewer's `NotePreference` row and
   * Prisma cannot sort notes by it, so this reads up to `NOTE_ORDER_MAX` visible
   * notes that match, orders them, and pages by "after this id". Visibility is
   * still in the query itself; nothing the viewer may not see is ever read.
   */
  async list(scope: NoteScope, viewerId: string, input: NoteListInput): Promise<NoteListResult> {
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? NOTE_PAGE_DEFAULT), 1), NOTE_PAGE_MAX);
    const firstPage = !input.after;

    const [rows, pins, order, tags] = await Promise.all([
      this.prisma.note.findMany({
        where: listWhere(scope, viewerId, input),
        orderBy: [...NEWEST],
        take: NOTE_ORDER_MAX,
        omit: { body: true },
      }),
      this.prisma.notePin.findMany({ where: { workspaceId: scope.workspaceId, userId: viewerId } }),
      this.order(scope, viewerId),
      firstPage ? this.visibleTags(scope, viewerId) : Promise.resolve(null),
    ]);

    const pinnedIds = new Set(pins.map((pin) => pin.noteId));
    const ordered =
      input.view === 'trash'
        ? [...rows].sort((a, b) => (b.trashedAt?.getTime() ?? 0) - (a.trashedAt?.getTime() ?? 0))
        : orderNotes(rows, order);

    // Pinned notes sit above the list on the first page and are left OUT of it,
    // so paging never shows one twice. The trash has no pinned section.
    const splitPinned = input.view !== 'trash';
    const pinned = splitPinned ? ordered.filter((note) => pinnedIds.has(note.id)).slice(0, NOTE_PINNED_MAX) : [];
    const rest = splitPinned ? ordered.filter((note) => !pinnedIds.has(note.id)) : ordered;

    // A cursor for a note no longer in the list (deleted, filtered out) pages from the start.
    const from = input.after ? rest.findIndex((note) => note.id === input.after) + 1 : 0;
    const notes = rest.slice(from, from + limit);
    const last = notes[notes.length - 1];
    return {
      pinned: firstPage ? pinned : [],
      notes,
      next: from + limit < rest.length && last ? last.id : null,
      tags,
      pinnedIds,
    };
  }

  /** The viewer's own order of their list, as note ids. No row means none: newest first. */
  async order(scope: NoteScope, viewerId: string): Promise<readonly string[]> {
    const row = await this.prisma.notePreference.findUnique({
      where: { userId_workspaceId: { userId: viewerId, workspaceId: scope.workspaceId } },
    });
    return row?.noteOrder ?? [];
  }

  /** One note with its body, or null — for one that does not exist AND for one the viewer may not see. */
  async get(scope: NoteScope, viewerId: string, noteId: string): Promise<{ note: NoteRow; pinned: boolean } | null> {
    const note = await this.prisma.note.findFirst({ where: { ...scope, id: noteId } });
    if (!note || !canSeeNote(note, viewerId)) return null;

    const pins = await this.prisma.notePin.findMany({ where: { workspaceId: scope.workspaceId, userId: viewerId } });
    return { note, pinned: pins.some((pin) => pin.noteId === noteId) };
  }

  /**
   * A note's revisions, newest first, or null when the note is not the viewer's
   * to see. Private notes have none — only their author ever writes them.
   */
  async revisions(scope: NoteScope, viewerId: string, noteId: string): Promise<readonly NoteRevisionRow[] | null> {
    const note = await this.prisma.note.findFirst({ where: { ...scope, id: noteId } });
    if (!note || !canSeeNote(note, viewerId)) return null;
    return this.prisma.noteRevision.findMany({ where: { noteId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  }

  /** The viewer's appearance settings here. No row, or a retired value, reads as the default. */
  async settings(scope: NoteScope, viewerId: string): Promise<NoteSettings> {
    const row = await this.prisma.notePreference.findUnique({
      where: { userId_workspaceId: { userId: viewerId, workspaceId: scope.workspaceId } },
    });
    return normalizeNoteSettings(row);
  }

  /**
   * Account names for the ids given. An id the directory does not know — or any
   * id at all when no directory is bound — is left out, and the app says
   * "a member".
   */
  async names(userIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const unique = [...new Set(userIds)];
    if (!this.directory || unique.length === 0) return new Map();
    const authors = await this.directory.describe(unique);
    return new Map(authors.map((author) => [author.userId, author.displayName]));
  }

  private async visibleTags(scope: NoteScope, viewerId: string): Promise<readonly string[]> {
    const rows = await this.prisma.note.findMany({
      where: { ...scope, trashedAt: null, AND: [visibleTo(viewerId)] },
      orderBy: [...NEWEST],
      take: NOTE_TAG_SCAN_MAX,
      omit: { body: true },
    });
    return [...new Set(rows.flatMap((row) => row.tags))].sort((a, b) => a.localeCompare(b));
  }
}

/**
 * ⚠ THE VISIBILITY CONDITION. Every list query carries it as the first `AND`
 * entry — the viewer's own notes, or shared ones — so a view, a search or a tag
 * only ever NARROWS what the viewer could see anyway.
 */
function visibleTo(viewerId: string): NoteListCondition {
  return { OR: [{ authorId: viewerId }, { visibility: 'workspace' }] };
}

function listWhere(scope: NoteScope, viewerId: string, input: NoteListInput): NoteListWhere {
  const conditions: NoteListCondition[] = [visibleTo(viewerId)];

  const term = prepareNoteSearch(input.search);
  if (term) {
    // ⚠ Escaped exactly once: Prisma's `contains` does not escape (see `escapeLikePattern`).
    const pattern = escapeLikePattern(term);
    conditions.push({
      OR: [{ title: { contains: pattern, mode: 'insensitive' } }, { body: { contains: pattern, mode: 'insensitive' } }],
    });
  }

  const tag = input.tag ? normalizeNoteTag(input.tag) : null;
  const where: NoteListWhere = {
    ...scope,
    trashedAt: input.view === 'trash' ? { not: null } : null,
    ...(tag ? { tags: { has: tag } } : {}),
    AND: conditions,
  };

  switch (input.view) {
    case 'all':
    case 'trash':
      return where;
    case 'mine':
      return { ...where, authorId: viewerId };
    case 'shared':
      return { ...where, visibility: 'workspace' };
  }
}
