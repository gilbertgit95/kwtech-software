import type { NoteVisibility } from '../types.js';

/**
 * The slice of a Prisma client this module uses — declared STRUCTURALLY, never
 * imported from a generated one.
 *
 * The module ships `prisma/note.prisma`; the host composes it into its own
 * schema and hands back the client. So this package has no `@prisma/client`
 * dependency and no opinion about which database the tables are in. The app's
 * `satisfies-modules.ts` proves its client fits, at compile time.
 *
 * Every argument shape here is one the services actually send, and nothing
 * more: a wider interface is a wider promise the fake in the tests would have
 * to keep.
 *
 * ⚠ EVERY NOTE LOOKUP NAMES ITS WORKSPACE AND ORGANIZATION (`InScope`). There is
 * no `{ id }`-only shape here to reach for: the guard proves membership of the
 * workspace in the REQUEST, not that the note is in it.
 */

type SortOrder = 'asc' | 'desc';

export interface NoteRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  authorId: string;
  title: string;
  body: string;
  preview: string;
  visibility: NoteVisibility;
  color: string;
  tags: string[];
  version: number;
  trashedAt: Date | null;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
}

/** A note as the index reads it: everything but the body. */
export type NoteSummaryRow = Omit<NoteRow, 'body'>;

export interface NotePinRow {
  userId: string;
  noteId: string;
  organizationId: string;
  workspaceId: string;
  createdAt: Date;
}

export interface NoteRevisionRow {
  id: string;
  noteId: string;
  organizationId: string;
  workspaceId: string;
  title: string;
  body: string;
  editedById: string;
  createdAt: Date;
}

export interface NotePreferenceRow {
  userId: string;
  workspaceId: string;
  organizationId: string;
  look: string;
  font: string;
  defaultColor: string;
  noteOrder: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface InScope {
  organizationId: string;
  workspaceId: string;
}

/** What a save may change. `version` always moves by one. */
export interface NoteUpdate {
  title?: string;
  body?: string;
  preview?: string;
  color?: string;
  tags?: string[];
  visibility?: NoteVisibility;
  trashedAt?: Date | null;
  updatedById?: string;
  version: { increment: 1 };
}

/** A text match, case-insensitive. The term is ALREADY escaped (`escapeLikePattern`). */
type TextMatch = { contains: string; mode: 'insensitive' };

/**
 * One condition inside the index's `AND`. Two kinds, each an `OR`:
 *
 *   who may see it   — `{ authorId: viewer }` or `{ visibility: 'workspace' }`
 *   the search term  — in the title or the body
 */
export type NoteListCondition =
  | { OR: Array<{ authorId: string } | { visibility: NoteVisibility }> }
  | { OR: Array<{ title: TextMatch } | { body: TextMatch }> };

export interface NoteListWhere extends InScope {
  /** Live notes, or the trash. Never both in one list. */
  trashedAt: null | { not: null };
  authorId?: string;
  visibility?: NoteVisibility;
  tags?: { has: string };
  /** ⚠ Visibility is ALWAYS the first entry — the index never runs without it. */
  AND: NoteListCondition[];
}

export interface NoteTransaction {
  note: {
    /** ⚠ The only way to find one note: by id AND scope. */
    findFirst(args: { where: InScope & { id: string } }): Promise<NoteRow | null>;
    /** The index and the tag list. ⚠ `omit: { body }` — see `NoteRow.preview`. */
    findMany(args: {
      where: NoteListWhere;
      orderBy: Array<{ createdAt: SortOrder } | { id: SortOrder }>;
      take: number;
      omit: { body: true };
    }): Promise<NoteSummaryRow[]>;
    /** The per-person count behind `note:notes`. Trashed notes included. */
    count(args: { where: InScope & { authorId: string } }): Promise<number>;
    create(args: {
      data: InScope & {
        authorId: string;
        title: string;
        body: string;
        preview: string;
        visibility: NoteVisibility;
        color: string;
        tags: string[];
        updatedById: string;
      };
    }): Promise<NoteRow>;
    /**
     * ⚠ EVERY WRITE IS A COMPARE-AND-SET on the version it was decided against.
     * Zero rows means somebody changed the note in between; the caller reads
     * again rather than overwriting what it never saw.
     */
    updateMany(args: {
      where: InScope & { id: string; version: number };
      data: NoteUpdate;
    }): Promise<{ count: number }>;
    deleteMany(args: { where: InScope & { id: string; version: number } }): Promise<{ count: number }>;
  };

  notePin: {
    findMany(args: { where: { workspaceId: string; userId: string } }): Promise<NotePinRow[]>;
    upsert(args: {
      where: { userId_noteId: { userId: string; noteId: string } };
      create: InScope & { userId: string; noteId: string };
      update: Record<string, never>;
    }): Promise<NotePinRow>;
    deleteMany(args: { where: { userId: string; noteId: string } }): Promise<{ count: number }>;
  };

  noteRevision: {
    findFirst(args: { where: InScope & { id: string; noteId: string } }): Promise<NoteRevisionRow | null>;
    findMany(args: {
      where: { noteId: string };
      orderBy: Array<{ createdAt: SortOrder } | { id: SortOrder }>;
      take?: number;
      skip?: number;
    }): Promise<NoteRevisionRow[]>;
    create(args: {
      data: InScope & { noteId: string; title: string; body: string; editedById: string };
    }): Promise<NoteRevisionRow>;
    deleteMany(args: { where: { id: { in: string[] } } }): Promise<{ count: number }>;
  };

  notePreference: {
    findUnique(args: {
      where: { userId_workspaceId: { userId: string; workspaceId: string } };
    }): Promise<NotePreferenceRow | null>;
    /** Settings and the order are written separately, so neither save clobbers the other. */
    upsert(args: {
      where: { userId_workspaceId: { userId: string; workspaceId: string } };
      create: InScope & { userId: string } & (
          | { look: string; font: string; defaultColor: string }
          | { noteOrder: string[] }
        );
      update: { look: string; font: string; defaultColor: string } | { noteOrder: string[] };
    }): Promise<NotePreferenceRow>;
  };
}

/** The read client. The same delegates; a host may bind a replica. */
export type NotePrismaClient = NoteTransaction;

export interface NoteWriteClient extends NoteTransaction {
  $transaction<T>(fn: (tx: NoteTransaction) => Promise<T>): Promise<T>;
}
