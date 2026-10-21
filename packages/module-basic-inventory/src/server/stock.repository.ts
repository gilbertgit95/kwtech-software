import type { StockItemKind, StockMoveKind, StockSource, StockUnit, StockUseRefKind } from '../types.js';

/**
 * The slice of a Prisma client this module uses — declared STRUCTURALLY, never
 * imported from a generated one.
 *
 * The module ships `prisma/stock.prisma`; the host composes it into its own
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
 * the row is in it. There is no `{ id }`-only shape to reach for. (A take's
 * lines are reached through their take, found in scope first.)
 */

type SortOrder = 'asc' | 'desc';

export interface InScope {
  organizationId: string;
  workspaceId: string;
}

export interface StockCategoryRow extends InScope {
  id: string;
  name: string;
  sortOrder: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockItemRow extends InScope {
  id: string;
  categoryId: string | null;
  kind: StockItemKind;
  name: string;
  code: string | null;
  unit: StockUnit;
  unitCost: number | null;
  lowStockAt: number | null;
  archivedAt: Date | null;
  createdById: string;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockUseRow extends InScope {
  id: string;
  source: StockSource;
  refKind: StockUseRefKind;
  refId: string;
  refItemId: string;
  refLabel: string;
  stockItemId: string;
  quantityPerUnit: number;
  createdById: string;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockMoveRow extends InScope {
  id: string;
  stockItemId: string;
  kind: StockMoveKind;
  quantity: number;
  unitCost: number | null;
  sourceKey: string | null;
  sourceLineId: string | null;
  takeId: string | null;
  wasteRefId: string | null;
  wasteRefLabel: string | null;
  reason: string | null;
  note: string | null;
  supplier: string | null;
  reference: string | null;
  clientId: string | null;
  createdById: string | null;
  createdAt: Date;
}

/** What a write sets on a new movement. Every field named, so a forgotten one fails to compile. */
export interface StockMoveFields extends InScope {
  stockItemId: string;
  kind: StockMoveKind;
  quantity: number;
  unitCost: number | null;
  sourceKey: string | null;
  sourceLineId: string | null;
  takeId: string | null;
  wasteRefId: string | null;
  wasteRefLabel: string | null;
  reason: string | null;
  note: string | null;
  supplier: string | null;
  reference: string | null;
  clientId: string | null;
  createdById: string | null;
}

export type StockTakeStatus = 'open' | 'confirmed' | 'abandoned';

export interface StockTakeRow extends InScope {
  id: string;
  status: StockTakeStatus;
  categoryIds: string[];
  note: string | null;
  createdById: string;
  closedById: string | null;
  createdAt: Date;
  closedAt: Date | null;
  updatedAt: Date;
}

export interface StockTakeLineRow {
  takeId: string;
  stockItemId: string;
  workspaceId: string;
  counted: number | null;
  onHandAtConfirm: number | null;
  updatedById: string;
  updatedAt: Date;
}

export interface StockFeedCursorRow {
  workspaceId: string;
  source: StockSource;
  organizationId: string;
  through: Date;
  updatedAt: Date;
}

/** Which movements a read asks for. Every shape names the workspace. */
export interface StockMoveWhere extends InScope {
  id?: string;
  stockItemId?: string | { in: string[] };
  sourceKey?: string;
  sourceLineId?: string;
  clientId?: string;
  kind?: { in: StockMoveKind[] };
  OR?: Array<{ createdAt: { lt: Date } } | { createdAt: Date; id: { lt: string } }>;
}

/** On hand per item: Postgres sums the `Int` column as a `BIGINT`, which Prisma returns as a number. */
export interface StockOnHandGroup {
  stockItemId: string;
  _sum: { quantity: number | null };
}

export interface StockTransaction {
  stockCategory: {
    findFirst(args: { where: InScope & { id: string } }): Promise<StockCategoryRow | null>;
    findMany(args: {
      where: InScope & { archivedAt?: null };
      orderBy: Array<{ sortOrder: SortOrder } | { name: SortOrder }>;
      take: number;
    }): Promise<StockCategoryRow[]>;
    create(args: { data: InScope & { name: string; sortOrder: number } }): Promise<StockCategoryRow>;
    updateMany(args: {
      where: InScope & { id: string };
      data: { name?: string; sortOrder?: number; archivedAt?: Date | null };
    }): Promise<{ count: number }>;
  };

  stockItem: {
    findFirst(args: { where: InScope & ({ id: string } | { code: string }) }): Promise<StockItemRow | null>;
    findMany(args: {
      where: InScope & { archivedAt?: null; id?: { in: string[] }; categoryId?: { in: string[] } };
      orderBy: Array<{ name: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<StockItemRow[]>;
    count(args: { where: InScope & { archivedAt: null } }): Promise<number>;
    create(args: {
      data: InScope & {
        categoryId: string | null;
        kind: StockItemKind;
        name: string;
        code: string | null;
        unit: StockUnit;
        unitCost: number | null;
        lowStockAt: number | null;
        createdById: string;
        updatedById: string;
      };
    }): Promise<StockItemRow>;
    updateMany(args: {
      where: InScope & { id: string };
      data: {
        categoryId?: string | null;
        kind?: StockItemKind;
        name?: string;
        code?: string | null;
        unit?: StockUnit;
        unitCost?: number | null;
        lowStockAt?: number | null;
        archivedAt?: Date | null;
        updatedById: string;
      };
    }): Promise<{ count: number }>;
  };

  stockUse: {
    findMany(args: {
      where: InScope & { source?: StockSource; refItemId?: { in: string[] }; refId?: string; stockItemId?: string };
      orderBy: Array<{ refKind: SortOrder } | { refLabel: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<StockUseRow[]>;
    count(args: { where: InScope & { stockItemId: string } }): Promise<number>;
    /** Replacing one product's list: its old lines go, in the same transaction as the new. Lines are setup, not history. */
    deleteMany(args: { where: InScope & { source: StockSource; refId: string } }): Promise<{ count: number }>;
    createMany(args: {
      data: Array<
        InScope & {
          source: StockSource;
          refKind: StockUseRefKind;
          refId: string;
          refItemId: string;
          refLabel: string;
          stockItemId: string;
          quantityPerUnit: number;
          createdById: string;
          updatedById: string;
        }
      >;
    }): Promise<{ count: number }>;
  };

  stockMove: {
    findFirst(args: { where: StockMoveWhere }): Promise<StockMoveRow | null>;
    findMany(args: {
      where: StockMoveWhere;
      orderBy: Array<{ createdAt: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<StockMoveRow[]>;
    groupBy(args: {
      by: ['stockItemId'];
      where: InScope & { stockItemId?: { in: string[] } };
      _sum: { quantity: true };
    }): Promise<StockOnHandGroup[]>;
    count(args: { where: InScope & { stockItemId: string } }): Promise<number>;
    /**
     * ⚠ `skipDuplicates` ONLY for another module's event: a replay of a line
     * already taken writes nothing (`@@unique([workspaceId, sourceKey,
     * stockItemId])`). A move made here relies on the client id clashing
     * instead, so a double press is caught and answered with the first.
     */
    createMany(args: { data: StockMoveFields[]; skipDuplicates?: boolean }): Promise<{ count: number }>;
  };

  stockTake: {
    findFirst(args: { where: InScope & ({ id: string } | { status: StockTakeStatus }) }): Promise<StockTakeRow | null>;
    findMany(args: {
      where: InScope;
      orderBy: Array<{ createdAt: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<StockTakeRow[]>;
    create(args: {
      data: InScope & { categoryIds: string[]; note: string | null; createdById: string };
    }): Promise<StockTakeRow>;
    /** ⚠ Only while OPEN, so a confirm and an abandon racing each other cannot both close it. */
    updateMany(args: {
      where: InScope & { id: string; status: 'open' };
      data: { status?: StockTakeStatus; closedById?: string; closedAt?: Date; note?: string | null };
    }): Promise<{ count: number }>;
  };

  stockTakeLine: {
    findMany(args: { where: { takeId: string } }): Promise<StockTakeLineRow[]>;
    createMany(args: {
      data: Array<{ takeId: string; stockItemId: string; workspaceId: string; updatedById: string }>;
    }): Promise<{ count: number }>;
    updateMany(args: {
      where: { takeId: string; stockItemId: string };
      data: { counted?: number | null; onHandAtConfirm?: number | null; updatedById: string };
    }): Promise<{ count: number }>;
  };

  stockFeedCursor: {
    findFirst(args: { where: { workspaceId: string; source: StockSource } }): Promise<StockFeedCursorRow | null>;
    /** The first list hung on a product starts the cursor; a second start changes nothing. */
    createMany(args: {
      data: Array<InScope & { source: StockSource; through: Date }>;
      skipDuplicates: true;
    }): Promise<{ count: number }>;
    updateMany(args: {
      where: { workspaceId: string; source: StockSource };
      data: { through: Date };
    }): Promise<{ count: number }>;
  };
}

/** The read client. The same delegates; a host may bind a replica. */
export type StockPrismaClient = StockTransaction;

export interface StockWriteClient extends StockTransaction {
  $transaction<T>(fn: (tx: StockTransaction) => Promise<T>): Promise<T>;
}
