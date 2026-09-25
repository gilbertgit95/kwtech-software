import type { NotificationSeverity } from '../types.js';

/**
 * The slice of a Prisma client this module uses — declared STRUCTURALLY, never
 * imported from a generated one.
 *
 * The module ships `prisma/notification.prisma`; the host composes it into its
 * own schema and hands the client back. The app's `satisfies-modules.ts` proves
 * that client fits, at compile time. Every argument shape here is one the
 * services actually send, and nothing more: a wider interface is a wider
 * promise the fake in the tests would have to keep.
 */

type SortOrder = 'asc' | 'desc';

export interface ItemRow {
  id: string;
  recipientId: string;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  source: string;
  organizationId: string | null;
  workspaceId: string | null;
  contextLabel: string | null;
  /** Json. Parsed by `readActions` on every read. */
  actions: unknown;
  dedupeKey: string | null;
  batchId: string;
  groupKey: string | null;
  groupCount: number;
  createdAt: Date;
  occurredAt: Date;
  readAt: Date | null;
  archivedAt: Date | null;
  recalledAt: Date | null;
  expiresAt: Date | null;
}

export interface BatchRow {
  id: string;
  senderId: string | null;
  source: string;
  severity: NotificationSeverity;
  title: string;
  recipientCount: number;
  createdAt: Date;
  recalledAt: Date | null;
  recalledById: string | null;
}

/** For a column that can be null: "is null", "is set", or a range. */
type NullableDateFilter = null | { not: null } | { lt: Date } | { gt: Date } | { gte: Date } | { lte: Date };
/**
 * For a column that is never null. ⚠ Kept separate: offering `null` here is a
 * filter Prisma's own types refuse, and `satisfies-modules.ts` catches the
 * difference at build time.
 */
type DateRange = { lt: Date } | { gt: Date } | { gte: Date } | { lte: Date };

/** The keyset step: strictly past `(occurredAt, id)` in one direction. */
export type KeysetClause =
  | { OR: [{ occurredAt: { lt: Date } }, { occurredAt: Date; id: { lt: string } }] }
  | { OR: [{ occurredAt: { gt: Date } }, { occurredAt: Date; id: { gt: string } }] };

export interface ItemWhere {
  id?: string | { in: string[] };
  recipientId?: string | { in: string[] };
  batchId?: string;
  severity?: NotificationSeverity;
  source?: string;
  organizationId?: string | null;
  groupKey?: string;
  readAt?: NullableDateFilter;
  archivedAt?: NullableDateFilter;
  recalledAt?: null;
  createdAt?: DateRange;
  occurredAt?: DateRange;
  OR?: KeysetClause['OR'];
}

/** What a new row carries; everything else is the schema's default. */
export interface ItemCreate {
  recipientId: string;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  source: string;
  organizationId: string | null;
  workspaceId: string | null;
  contextLabel: string | null;
  // A plain array of plain objects is what the Json column holds; the domain
  // types narrow it on the way out.
  actions: object[];
  dedupeKey: string | null;
  batchId: string;
  groupKey: string | null;
  expiresAt: Date | null;
}

export interface ItemUpdate {
  readAt?: Date | null;
  archivedAt?: Date | null;
  recalledAt?: Date;
  dedupeKey?: null;
  title?: string;
  body?: string | null;
  actions?: object[];
  groupCount?: { increment: number };
  occurredAt?: Date;
  severity?: NotificationSeverity;
  expiresAt?: Date | null;
}

type ItemOrder = Array<{ occurredAt: SortOrder } | { id: SortOrder }>;

export interface NotificationTransaction {
  notificationItem: {
    findMany(args: { where: ItemWhere; orderBy?: ItemOrder; take?: number }): Promise<ItemRow[]>;
    count(args: { where: ItemWhere }): Promise<number>;
    /**
     * ⚠ `skipDuplicates` is what makes `dedupeKey` work for a fan-out: a row
     * whose `(recipientId, dedupeKey)` already exists is skipped rather than
     * failing the other 499. `AndReturn`, because the rows written are the
     * rows published — a skipped duplicate must not toast again.
     */
    createManyAndReturn(args: { data: ItemCreate[]; skipDuplicates: true }): Promise<ItemRow[]>;
    update(args: { where: { id: string }; data: ItemUpdate }): Promise<ItemRow>;
    updateMany(args: { where: ItemWhere; data: ItemUpdate }): Promise<{ count: number }>;
  };

  notificationBatch: {
    findUnique(args: { where: { id: string } }): Promise<BatchRow | null>;
    findMany(args: {
      where: { senderId?: string; OR?: BatchKeyset };
      orderBy: Array<{ createdAt: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<BatchRow[]>;
    create(args: {
      data: {
        senderId: string | null;
        source: string;
        severity: NotificationSeverity;
        title: string;
        recipientCount: number;
      };
    }): Promise<BatchRow>;
    update(args: {
      where: { id: string };
      data: { recipientCount?: number; recalledAt?: Date; recalledById?: string | null };
    }): Promise<BatchRow>;
  };
}

/** The Sent list's keyset, newest first. */
export type BatchKeyset = [{ createdAt: { lt: Date } }, { createdAt: Date; id: { lt: string } }];

export type NotificationPrismaClient = NotificationTransaction;

export interface NotificationWriteClient extends NotificationTransaction {
  $transaction<T>(fn: (tx: NotificationTransaction) => Promise<T>): Promise<T>;
}
