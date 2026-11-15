import type { FileVisibility } from '../types.js';

/**
 * The rows and the STRUCTURAL client the services send queries through — only
 * the delegate methods and argument shapes they actually use. The app's
 * Prisma client satisfies it (`satisfies-modules.ts` checks at compile time);
 * this module never imports `@prisma/client`.
 */

type SortOrder = 'asc' | 'desc';

/** Every tenant query names both: a file is found by id AND scope, never by id alone. */
export interface InScope {
  organizationId: string;
  workspaceId: string;
}

export interface FileEntryRow extends InScope {
  id: string;
  ownerId: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  visibility: FileVisibility;
  createdAt: Date;
  updatedAt: Date;
}

export interface FileShareRow extends InScope {
  fileId: string;
  userId: string;
  createdAt: Date;
}

export interface FileSettingsRow {
  workspaceId: string;
  organizationId: string;
  retentionHours: number;
  updatedById: string;
  updatedAt: Date;
}

export type FileTicketKind = 'upload' | 'download';

export interface FileTicketRow extends InScope {
  tokenHash: string;
  kind: FileTicketKind;
  actorId: string;
  fileId: string | null;
  name: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  visibility: FileVisibility | null;
  sharedWith: string[];
  expiresAt: Date;
  createdAt: Date;
}

/** What one person may see in a workspace: their own, the workspace's, and those shared with them by id. */
export type FileVisibleWhere = InScope & {
  OR: Array<{ ownerId: string } | { visibility: 'workspace' } | { id: { in: string[] } }>;
};

export interface FileTransaction {
  fileEntry: {
    findFirst(args: { where: InScope & { id: string } }): Promise<FileEntryRow | null>;
    findMany(args: {
      /**
       * The list (`FileVisibleWhere`), the clean-up's sweep (older than a
       * cutoff), and the stray sweep's "which of these keys are files".
       */
      where: FileVisibleWhere | (InScope & { createdAt: { lt: Date } }) | (InScope & { storageKey: { in: string[] } });
      orderBy: Array<{ createdAt: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<FileEntryRow[]>;
    /** The room the workspace's files take: `storage_mb` is checked against it. */
    aggregate(args: { where: InScope; _sum: { sizeBytes: true } }): Promise<{ _sum: { sizeBytes: number | null } }>;
    create(args: {
      data: InScope & {
        ownerId: string;
        name: string;
        contentType: string;
        sizeBytes: number;
        storageKey: string;
        visibility: FileVisibility;
      };
    }): Promise<FileEntryRow>;
    updateMany(args: {
      where: InScope & { id: string; ownerId: string };
      data: { visibility: FileVisibility };
    }): Promise<{ count: number }>;
    deleteMany(args: {
      where: InScope & { id: string; ownerId?: string; createdAt?: { lt: Date } };
    }): Promise<{ count: number }>;
  };

  fileShare: {
    findMany(args: {
      where: InScope & ({ userId: string } | { fileId: { in: string[] } });
      take: number;
    }): Promise<FileShareRow[]>;
    createMany(args: { data: Array<InScope & { fileId: string; userId: string }> }): Promise<{ count: number }>;
    deleteMany(args: { where: InScope & { fileId: string } }): Promise<{ count: number }>;
  };

  fileSettings: {
    findUnique(args: { where: { workspaceId: string } }): Promise<FileSettingsRow | null>;
    upsert(args: {
      where: { workspaceId: string };
      create: InScope & { retentionHours: number; updatedById: string };
      update: { retentionHours: number; updatedById: string };
    }): Promise<FileSettingsRow>;
  };

  /** One-time tickets for the byte routes. ⚠ Found by `tokenHash` alone: the ticket IS the authority. */
  fileTicket: {
    findUnique(args: { where: { tokenHash: string } }): Promise<FileTicketRow | null>;
    count(args: { where: { actorId: string; expiresAt: { gt: Date } } }): Promise<number>;
    create(args: {
      data: InScope & {
        tokenHash: string;
        kind: FileTicketKind;
        actorId: string;
        fileId?: string | null;
        name?: string | null;
        contentType?: string | null;
        sizeBytes?: number | null;
        visibility?: FileVisibility | null;
        sharedWith?: string[];
        expiresAt: Date;
      };
    }): Promise<FileTicketRow>;
    /** Spending (`tokenHash` + `kind` + not expired) and the sweep (`expiresAt` passed). */
    deleteMany(args: {
      where: { tokenHash: string; kind: FileTicketKind; expiresAt: { gt: Date } } | { expiresAt: { lte: Date } };
    }): Promise<{ count: number }>;
  };
}

/** The read client. The same delegates; a host may bind a replica. */
export type FilePrismaClient = FileTransaction;

export interface FileWriteClient extends FileTransaction {
  $transaction<T>(fn: (tx: FileTransaction) => Promise<T>): Promise<T>;
}
