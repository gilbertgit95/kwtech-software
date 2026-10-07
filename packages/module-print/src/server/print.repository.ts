/**
 * The slice of a Prisma client this module uses — declared STRUCTURALLY, never
 * imported from a generated one.
 *
 * The module ships `prisma/print.prisma`; the host composes it into its own
 * schema and hands back the client. So this package has no `@prisma/client`
 * dependency and no opinion about which database the tables are in. The app's
 * `satisfies-modules.ts` proves its client fits, at compile time.
 *
 * Every argument shape here is one the services actually send, and nothing
 * more: a wider interface is a wider promise the fake in the tests would have
 * to keep.
 *
 * ⚠ TWO KINDS OF LOOKUP, and only two. A PERSON's names the workspace and the
 * organization (`InScope`), because the guard proves membership of the
 * workspace in the request and not that the row is in it. A COMPUTER's is by
 * the hash of a credential it presented (`secretHash`, `codeHash`), which
 * names its own row and nothing else.
 */

type SortOrder = 'asc' | 'desc';

export interface PrintAgentRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  hostName: string | null;
  agentVersion: string | null;
  secretHash: string;
  pairedById: string;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  revokedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrintPairingCodeRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  codeHash: string;
  name: string;
  createdById: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface PrintPrinterRow {
  id: string;
  organizationId: string;
  workspaceId: string;
  agentId: string;
  name: string;
  driver: string;
  isDefault: boolean;
  status: string;
  /** ⚠ `unknown` on purpose: a `Json` column. Read through `preparePapers`, never cast. */
  papers: unknown;
  /** ⚠ `unknown` for the same reason. Read through `prepareSettings`; `{}` for a row written before settings existed. */
  settings: unknown;
  reportedAt: Date;
  goneAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InScope {
  organizationId: string;
  workspaceId: string;
}

/** What a report writes for one printer, new or known. */
export interface PrintPrinterValues {
  driver: string;
  isDefault: boolean;
  status: string;
  /** Clean `PrintPaper[]`, as a plain JSON value. */
  papers: object;
  /** Clean `PrintPrinterSettings`, as a plain JSON value. Never null: empty lists say "none". */
  settings: object;
  reportedAt: Date;
  goneAt: null;
}

export interface PrintTransaction {
  printAgent: {
    /** ⚠ A person's only way to find one computer: by id AND scope. */
    findFirst(args: { where: InScope & { id: string } }): Promise<PrintAgentRow | null>;
    /** ⚠ A computer's only way in: the hash of the secret it presented. */
    findUnique(args: { where: { secretHash: string } }): Promise<PrintAgentRow | null>;
    /** The workspace's computers that are still paired. */
    findMany(args: {
      where: InScope & { revokedAt: null };
      orderBy: Array<{ name: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<PrintAgentRow[]>;
    /** The count behind `print:agents`. Revoked computers are not in it. */
    count(args: { where: InScope & { revokedAt: null } }): Promise<number>;
    create(args: {
      data: InScope & {
        name: string;
        hostName: string | null;
        agentVersion: string | null;
        secretHash: string;
        pairedById: string;
        lastSeenAt: Date | null;
      };
    }): Promise<PrintAgentRow>;
    /**
     * ⚠ `revokedAt: null` IS IN EVERY WHERE. A heartbeat and a revocation are
     * both "only if it is still paired", and zero rows is the answer "it is
     * not" — never a read followed by a write.
     */
    updateMany(args: {
      where: ({ id: string } | (InScope & { id: string })) & { revokedAt: null };
      data: { lastSeenAt: Date } | { revokedAt: Date; revokedById: string };
    }): Promise<{ count: number }>;
  };

  printPairingCode: {
    findUnique(args: { where: { codeHash: string } }): Promise<PrintPairingCodeRow | null>;
    create(args: {
      data: InScope & { codeHash: string; name: string; createdById: string; expiresAt: Date };
    }): Promise<PrintPairingCodeRow>;
    /** ⚠ The claim: `usedAt: null` in the where, so two computers cannot both use one code. */
    updateMany(args: { where: { id: string; usedAt: null }; data: { usedAt: Date } }): Promise<{ count: number }>;
    /** Housekeeping: a workspace's used and expired codes, removed when the next one is made. */
    deleteMany(args: {
      where: InScope & { OR: Array<{ usedAt: { not: null } } | { expiresAt: { lt: Date } }> };
    }): Promise<{ count: number }>;
  };

  printPrinter: {
    /** ⚠ A person's only way to find one printer: by id AND scope. */
    findFirst(args: { where: InScope & { id: string } }): Promise<PrintPrinterRow | null>;
    findMany(args: {
      where: { agentId: string } | { agentId: { in: string[] } };
      orderBy: Array<{ name: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<PrintPrinterRow[]>;
    /** ⚠ By the `@@unique([agentId, name])`, so two reports at once still leave one row. */
    upsert(args: {
      where: { agentId_name: { agentId: string; name: string } };
      create: InScope & { agentId: string; name: string } & PrintPrinterValues;
      update: PrintPrinterValues;
    }): Promise<PrintPrinterRow>;
    /** Printers a report no longer lists. */
    updateMany(args: {
      where: { agentId: string; name: { in: string[] }; goneAt: null };
      data: { goneAt: Date };
    }): Promise<{ count: number }>;
  };
}

/** The read client. The same delegates; a host may bind a replica. */
export type PrintPrismaClient = PrintTransaction;

export interface PrintWriteClient extends PrintTransaction {
  $transaction<T>(fn: (tx: PrintTransaction) => Promise<T>): Promise<T>;
}
