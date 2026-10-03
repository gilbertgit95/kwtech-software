import type { BooksEntryKind, BooksPlace, BooksShareMode } from '../types.js';

/**
 * The slice of a Prisma client this module uses — declared STRUCTURALLY, never
 * imported from a generated one.
 *
 * The module ships `prisma/books.prisma`; the host composes it into its own
 * schema and hands back the client. So this package has no `@prisma/client`
 * dependency. The app's `satisfies-modules.ts` proves its client fits, at
 * compile time.
 *
 * Every argument shape here is one the services actually send, and nothing
 * more: a wider interface is a wider promise the fake in the tests would have
 * to keep.
 *
 * ⚠ EVERY LOOKUP BY ID NAMES ITS WORKSPACE AND ORGANIZATION (`InScope`). The
 * guard proves the caller belongs to the workspace in the request, not that
 * the row is in it. There is no `{ id }`-only shape to reach for.
 *
 * ⚠ AMOUNTS ARE `bigint` ON THE WAY OUT (the columns are `BigInt`, see
 * prisma/books.prisma) and `number` on the way in, which Prisma accepts for a
 * `BigInt` column. `books.lookup.ts` turns rows into numbers once.
 */

type SortOrder = 'asc' | 'desc';

export interface InScope {
  organizationId: string;
  workspaceId: string;
}

export interface BooksInvestorRow extends InScope {
  id: string;
  name: string;
  nameKey: string;
  contact: string | null;
  note: string | null;
  agreedShare: number | null;
  formerAt: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BooksLoanRow extends InScope {
  id: string;
  borrowerName: string;
  contact: string | null;
  note: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BooksEntryRow extends InScope {
  id: string;
  kind: BooksEntryKind;
  amount: bigint;
  place: BooksPlace | null;
  toPlace: BooksPlace | null;
  /** A `DATE`: midnight UTC of the day (`booksDayFromDate`). */
  day: Date;
  category: string | null;
  description: string | null;
  reference: string | null;
  investorId: string | null;
  loanId: string | null;
  importId: string | null;
  shareId: string | null;
  advance: boolean;
  clientId: string | null;
  recordedById: string;
  createdAt: Date;
  voidedAt: Date | null;
  voidedById: string | null;
  voidReason: string | null;
}

/** What a write sets on a new entry. */
export interface BooksEntryFields {
  kind: BooksEntryKind;
  amount: number;
  place: BooksPlace | null;
  toPlace: BooksPlace | null;
  day: Date;
  category: string | null;
  description: string | null;
  reference: string | null;
  investorId: string | null;
  loanId: string | null;
  importId: string | null;
  shareId: string | null;
  advance: boolean;
  clientId: string | null;
  recordedById: string;
}

export interface BooksSalesImportRow extends InScope {
  id: string;
  fromDay: Date;
  toDay: Date;
  cash: bigint;
  ewallet: bigint;
  bank: bigint;
  costOfGoods: bigint;
  costCoverage: number;
  orders: number;
  clientId: string;
  recordedById: string;
  createdAt: Date;
  voidedAt: Date | null;
  voidedById: string | null;
  voidReason: string | null;
}

export interface BooksProfitShareRow extends InScope {
  id: string;
  fromDay: Date;
  toDay: Date;
  sales: bigint;
  refunds: bigint;
  costOfGoods: bigint;
  expenses: bigint;
  profit: bigint;
  kept: bigint;
  shared: bigint;
  mode: BooksShareMode;
  clientId: string;
  recordedById: string;
  createdAt: Date;
  voidedAt: Date | null;
  voidedById: string | null;
  voidReason: string | null;
}

export interface BooksSettingsRow {
  workspaceId: string;
  organizationId: string;
  shareMode: BooksShareMode;
  posImportFrom: Date | null;
  posRecordedThrough: Date | null;
  sharedThrough: Date | null;
  version: number;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
}

/** What a void writes. */
interface VoidFields {
  voidedAt: Date;
  voidedById: string;
  voidReason: string;
}

/** Which entries a read asks for. Every shape names the workspace. */
export interface BooksEntryWhere extends InScope {
  voidedAt?: null;
  day?: { gte: Date; lte: Date };
  investorId?: string;
  loanId?: string;
  shareId?: string;
}

/** The watermarks a profit share or an import moves. */
export interface BooksSettingsMarks {
  posRecordedThrough?: Date | null;
  sharedThrough?: Date | null;
}

export interface BooksTransaction {
  booksInvestor: {
    findFirst(args: { where: InScope & ({ id: string } | { nameKey: string }) }): Promise<BooksInvestorRow | null>;
    findMany(args: {
      where: InScope;
      orderBy: Array<{ name: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<BooksInvestorRow[]>;
    create(args: {
      data: InScope & {
        name: string;
        nameKey: string;
        contact: string | null;
        note: string | null;
        agreedShare: number | null;
        createdById: string;
      };
    }): Promise<BooksInvestorRow>;
    updateMany(args: {
      where: InScope & { id: string };
      data: {
        name?: string;
        nameKey?: string;
        contact?: string | null;
        note?: string | null;
        agreedShare?: number | null;
        formerAt?: Date | null;
      };
    }): Promise<{ count: number }>;
  };

  booksLoan: {
    findFirst(args: { where: InScope & { id: string } }): Promise<BooksLoanRow | null>;
    findMany(args: {
      where: InScope;
      orderBy: Array<{ createdAt: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<BooksLoanRow[]>;
    create(args: {
      data: InScope & { borrowerName: string; contact: string | null; note: string | null; createdById: string };
    }): Promise<BooksLoanRow>;
    updateMany(args: {
      where: InScope & { id: string };
      data: { borrowerName: string; contact: string | null; note: string | null };
    }): Promise<{ count: number }>;
  };

  booksEntry: {
    findFirst(args: { where: InScope & ({ id: string } | { clientId: string }) }): Promise<BooksEntryRow | null>;
    findMany(args: {
      where: BooksEntryWhere;
      orderBy: Array<{ day: SortOrder } | { createdAt: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<BooksEntryRow[]>;
    create(args: { data: InScope & BooksEntryFields }): Promise<BooksEntryRow>;
    /**
     * Voids: one entry, or every entry of an import or a profit share.
     * ⚠ ONLY LIVE ONES (`voidedAt: null`), so a second void never rewrites who
     * voided it first and why.
     */
    updateMany(args: {
      where: InScope & ({ id: string } | { importId: string } | { shareId: string }) & { voidedAt: null };
      data: VoidFields;
    }): Promise<{ count: number }>;
  };

  booksSalesImport: {
    findFirst(args: { where: InScope & ({ id: string } | { clientId: string }) }): Promise<BooksSalesImportRow | null>;
    findMany(args: {
      where: InScope & { voidedAt?: null };
      orderBy: Array<{ toDay: SortOrder } | { createdAt: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<BooksSalesImportRow[]>;
    create(args: {
      data: InScope & {
        fromDay: Date;
        toDay: Date;
        cash: number;
        ewallet: number;
        bank: number;
        costOfGoods: number;
        costCoverage: number;
        orders: number;
        clientId: string;
        recordedById: string;
      };
    }): Promise<BooksSalesImportRow>;
    updateMany(args: { where: InScope & { id: string; voidedAt: null }; data: VoidFields }): Promise<{ count: number }>;
  };

  booksProfitShare: {
    findFirst(args: { where: InScope & ({ id: string } | { clientId: string }) }): Promise<BooksProfitShareRow | null>;
    findMany(args: {
      where: InScope & { voidedAt?: null };
      orderBy: Array<{ toDay: SortOrder } | { createdAt: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<BooksProfitShareRow[]>;
    create(args: {
      data: InScope & {
        fromDay: Date;
        toDay: Date;
        sales: number;
        refunds: number;
        costOfGoods: number;
        expenses: number;
        profit: number;
        kept: number;
        shared: number;
        mode: BooksShareMode;
        clientId: string;
        recordedById: string;
      };
    }): Promise<BooksProfitShareRow>;
    updateMany(args: { where: InScope & { id: string; voidedAt: null }; data: VoidFields }): Promise<{ count: number }>;
  };

  booksSettings: {
    findUnique(args: { where: { workspaceId: string } }): Promise<BooksSettingsRow | null>;
    /**
     * ⚠ THE WRITE LOCK (`lockBooks`): every write upserts the row, bumping its
     * version, before it reads anything it decides on.
     */
    upsert(args: {
      where: { workspaceId: string };
      create: InScope & {
        updatedById: string;
        shareMode?: BooksShareMode;
        posImportFrom?: Date | null;
      };
      update: {
        version: { increment: 1 };
        updatedById?: string;
        shareMode?: BooksShareMode;
        posImportFrom?: Date | null;
      };
    }): Promise<BooksSettingsRow>;
    /** Moves a watermark IF the row is still at `version`: the compare-and-set a share or an import commits with. */
    updateMany(args: {
      where: InScope & { version: number };
      data: BooksSettingsMarks & { version: { increment: 1 }; updatedById: string };
    }): Promise<{ count: number }>;
  };
}

/** The read client. The same delegates; a host may bind a replica. */
export type BooksPrismaClient = BooksTransaction;

export interface BooksWriteClient extends BooksTransaction {
  $transaction<T>(fn: (tx: BooksTransaction) => Promise<T>): Promise<T>;
}
