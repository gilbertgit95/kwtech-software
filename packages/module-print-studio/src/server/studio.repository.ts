import type { StudioLogAction, StudioLogKind } from '../domain/log.js';
import type { StudioVisibility } from '../types.js';

/**
 * The slice of a Prisma client this module uses — declared STRUCTURALLY, never
 * imported from a generated one.
 *
 * The module ships `prisma/studio.prisma`; the host composes it into its own
 * schema and hands back the client. So this package has no `@prisma/client`
 * dependency and no opinion about which database the tables are in. The app's
 * `satisfies-modules.ts` proves its client fits, at compile time.
 *
 * Every argument shape here is one the services actually send, and nothing
 * more: a wider interface is a wider promise the fake in the tests would have
 * to keep.
 *
 * ⚠ EVERY LOOKUP NAMES ITS WORKSPACE AND ORGANIZATION (`InScope`). There is no
 * `{ id }`-only shape here to reach for: the guard proves membership of the
 * workspace in the REQUEST, not that the row is in it.
 */

type SortOrder = 'asc' | 'desc';

export interface StudioLayoutRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  visibility: StudioVisibility;
  /** What kind of work it is for. Null: none. */
  tag: string | null;
  /** ⚠ `unknown` on purpose: a `Json` column. Read through `prepareLayoutSpec`, never cast. */
  spec: unknown;
  version: number;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StudioCalibrationRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StudioLogRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  userId: string;
  action: StudioLogAction;
  kind: StudioLogKind;
  layoutId: string | null;
  layoutName: string | null;
  paperLabel: string;
  paperWidth: number;
  paperHeight: number;
  pages: number;
  copies: number;
  fileNames: string[];
  createdAt: Date;
}

export interface InScope {
  organizationId: string;
  workspaceId: string;
}

/** What a save may change. `version` always moves by one. */
export interface StudioLayoutUpdate {
  name?: string;
  /** A clean `StudioLayoutSpec`, as a plain JSON value. */
  spec?: object;
  visibility?: StudioVisibility;
  /** Null takes the tag off. */
  tag?: string | null;
  updatedById: string;
  version: { increment: 1 };
}

export interface StudioCalibrationValues {
  name: string;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

export interface StudioTransaction {
  studioLayout: {
    /** ⚠ The only way to find one layout: by id AND scope. */
    findFirst(args: { where: InScope & { id: string } }): Promise<StudioLayoutRow | null>;
    /** Your own, or the workspace's shared ones. Two queries, never one that could forget a condition. */
    findMany(args: {
      where: InScope & ({ ownerId: string } | { visibility: StudioVisibility; ownerId: { not: string } });
      orderBy: Array<{ name: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<StudioLayoutRow[]>;
    /** The per-person count behind `studio:layouts`. */
    count(args: { where: InScope & { ownerId: string } }): Promise<number>;
    create(args: {
      data: InScope & {
        ownerId: string;
        name: string;
        visibility: StudioVisibility;
        tag: string | null;
        spec: object;
        updatedById: string;
      };
    }): Promise<StudioLayoutRow>;
    /**
     * ⚠ EVERY WRITE IS A COMPARE-AND-SET on the version it was decided against.
     * Zero rows means somebody changed the layout in between; the caller reads
     * again rather than overwriting what it never saw.
     */
    updateMany(args: {
      where: InScope & { id: string; version: number };
      data: StudioLayoutUpdate;
    }): Promise<{ count: number }>;
    deleteMany(args: { where: InScope & { id: string; version: number } }): Promise<{ count: number }>;
  };

  studioCalibration: {
    /** ⚠ Always the owner's own: `ownerId` is part of every shape. */
    findFirst(args: { where: InScope & { id: string; ownerId: string } }): Promise<StudioCalibrationRow | null>;
    findMany(args: {
      where: InScope & { ownerId: string };
      orderBy: Array<{ name: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<StudioCalibrationRow[]>;
    count(args: { where: InScope & { ownerId: string } }): Promise<number>;
    /** ⚠ Raises `P2002` on a name the person already uses here (`@@unique`). */
    create(args: { data: InScope & { ownerId: string } & StudioCalibrationValues }): Promise<StudioCalibrationRow>;
    updateMany(args: {
      where: InScope & { id: string; ownerId: string };
      data: StudioCalibrationValues;
    }): Promise<{ count: number }>;
    deleteMany(args: { where: InScope & { id: string; ownerId: string } }): Promise<{ count: number }>;
  };

  studioLog: {
    /** One more than the page, to know whether another follows. */
    findMany(args: {
      where: InScope & { userId?: string; createdAt?: { lt: Date } };
      orderBy: Array<{ createdAt: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<StudioLogRow[]>;
    create(args: {
      data: InScope & {
        userId: string;
        action: StudioLogAction;
        kind: StudioLogKind;
        layoutId: string | null;
        layoutName: string | null;
        paperLabel: string;
        paperWidth: number;
        paperHeight: number;
        pages: number;
        copies: number;
        fileNames: string[];
      };
    }): Promise<StudioLogRow>;
    /** The prune: everything in one workspace older than the cutoff. */
    deleteMany(args: { where: InScope & { createdAt: { lt: Date } } }): Promise<{ count: number }>;
  };

  studioSettings: {
    findUnique(args: { where: { workspaceId: string } }): Promise<StudioSettingsRow | null>;
    upsert(args: {
      where: { workspaceId: string };
      create: InScope & { keymap: StudioJsonInput; updatedById: string };
      update: { keymap: StudioJsonInput; updatedById: string; version: { increment: 1 } };
    }): Promise<StudioSettingsRow>;
  };
}

/**
 * JSON as Prisma accepts it for a `Json` column. A keymap is a flat object of
 * strings, so this is all it needs to say.
 */
export type StudioJsonInput = Record<string, string>;

export interface StudioSettingsRow {
  workspaceId: string;
  organizationId: string;
  /** ⚠ `unknown` on purpose: a `Json` column. Read through `effectiveStudioKeymap`, never cast. */
  keymap: unknown;
  version: number;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
}

/** The read client. The same delegates; a host may bind a replica. */
export type StudioPrismaClient = StudioTransaction;

export interface StudioWriteClient extends StudioTransaction {
  $transaction<T>(fn: (tx: StudioTransaction) => Promise<T>): Promise<T>;
}
