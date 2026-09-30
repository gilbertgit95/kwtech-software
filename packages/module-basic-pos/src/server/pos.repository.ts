import type { PosChangeSettlement } from '../domain/orders.js';
import type { PosDiscount, PosItemKind, PosOrderStatus, PosPaymentMethod } from '../types.js';

type PosDiscountKindValue = PosDiscount['kind'];
type PosChangeSettlementValue = PosChangeSettlement;

/**
 * The slice of a Prisma client this module uses — declared STRUCTURALLY, never
 * imported from a generated one.
 *
 * The module ships `prisma/pos.prisma`; the host composes it into its own
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
 */

type SortOrder = 'asc' | 'desc';

export interface InScope {
  organizationId: string;
  workspaceId: string;
}

export interface PosCategoryRow extends InScope {
  id: string;
  name: string;
  nameKey: string;
  sortOrder: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PosItemRow extends InScope {
  id: string;
  categoryId: string | null;
  kind: PosItemKind;
  name: string;
  code: string | null;
  description: string | null;
  price: number;
  cost: number | null;
  archivedAt: Date | null;
  createdById: string;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PosItemVariantRow extends InScope {
  id: string;
  itemId: string;
  name: string;
  code: string | null;
  price: number;
  cost: number | null;
  sortOrder: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PosCustomerRow extends InScope {
  id: string;
  name: string;
  contact: string | null;
  note: string | null;
  archivedAt: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PosOrderRow extends InScope {
  id: string;
  status: PosOrderStatus;
  version: number;
  number: number | null;
  label: string | null;
  customerId: string | null;
  customerName: string | null;
  customerContact: string | null;
  gross: number;
  lineDiscounts: number;
  subtotal: number;
  orderDiscount: number;
  total: number;
  discountKind: PosDiscountKindValue | null;
  discountValue: number | null;
  discountReason: string | null;
  discountById: string | null;
  discountAt: Date | null;
  paymentMethod: PosPaymentMethod | null;
  received: number | null;
  change: number | null;
  tip: number;
  paymentReference: string | null;
  paymentClientId: string | null;
  changeOwed: number;
  changeSettlement: PosChangeSettlementValue | null;
  changeSettledAt: Date | null;
  changeSettledById: string | null;
  createdById: string;
  finalisedAt: Date | null;
  finalisedById: string | null;
  releasedUnpaid: boolean;
  paidAt: Date | null;
  paidById: string | null;
  cancelledAt: Date | null;
  cancelledById: string | null;
  cancelReason: string | null;
  voidedAt: Date | null;
  voidedById: string | null;
  voidReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PosOrderLineRow extends InScope {
  id: string;
  orderId: string;
  position: number;
  itemId: string;
  variantId: string | null;
  name: string;
  kind: PosItemKind;
  variantName: string | null;
  code: string | null;
  categoryName: string | null;
  unitPrice: number;
  unitCost: number | null;
  quantity: number;
  note: string | null;
  discountKind: PosDiscountKindValue | null;
  discountValue: number | null;
  discountAmount: number;
  discountReason: string | null;
  discountById: string | null;
  discountAt: Date | null;
  gross: number;
  total: number;
  net: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PosRefundRow extends InScope {
  id: string;
  orderId: string;
  amount: number;
  method: PosPaymentMethod;
  reason: string;
  refundedById: string;
  refundedAt: Date;
  clientId: string;
}

export interface PosRefundLineRow extends InScope {
  id: string;
  refundId: string;
  orderLineId: string;
  quantity: number;
  amount: number;
}

export interface PosCounterRow {
  workspaceId: string;
  organizationId: string;
  nextNumber: number;
}

export interface PosSettingsRow {
  workspaceId: string;
  organizationId: string;
  /** A `PosKeymap` as JSON, or null for the defaults. Read through `effectiveKeymap`, never trusted as typed. */
  keymap: unknown;
  version: number;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Live rows, or archived ones. */
type ArchivedFilter = null | { not: null };

/** An item's or variant's fields a write sets. */
export interface PosItemFields {
  categoryId: string | null;
  kind: PosItemKind;
  name: string;
  code: string | null;
  description: string | null;
  price: number;
  cost: number | null;
}

/** An order line's fields a write sets: everything but its ids and timestamps. */
export type PosOrderLineFields = Omit<PosOrderLineRow, 'id' | 'createdAt' | 'updatedAt'>;

/** What a write may change on an order. `version` always increments. */
export type PosOrderUpdate = Partial<
  Omit<PosOrderRow, 'id' | 'organizationId' | 'workspaceId' | 'version' | 'createdAt' | 'updatedAt' | 'createdById'>
> & { version: { increment: 1 } };

export interface PosOrderListWhere extends InScope {
  status?: PosOrderStatus | { in: PosOrderStatus[] };
  customerId?: string;
  number?: number;
  changeOwed?: { gt: number };
  changeSettledAt?: null;
  paidAt?: { gte: Date; lt: Date } | { lt: Date };
  finalisedAt?: { gte: Date; lt: Date };
  cancelledAt?: { gte: Date; lt: Date };
  OR?: Array<
    | { paidAt: { gte: Date; lt: Date } }
    | { finalisedAt: { gte: Date; lt: Date } }
    | { cancelledAt: { gte: Date; lt: Date } }
    | { changeSettledAt: { gte: Date; lt: Date } }
    | { status: PosOrderStatus }
    | { customerName: { contains: string; mode: 'insensitive' } }
    | { label: { contains: string; mode: 'insensitive' } }
    | { number: number }
  >;
}

export interface PosTransaction {
  posCategory: {
    findFirst(args: { where: InScope & ({ id: string } | { nameKey: string }) }): Promise<PosCategoryRow | null>;
    findMany(args: {
      where: InScope & { archivedAt?: ArchivedFilter; id?: { in: string[] } };
      orderBy: Array<{ sortOrder: SortOrder } | { name: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<PosCategoryRow[]>;
    /** How many a store has, archived ones included: the cap is on rows kept. */
    count(args: { where: InScope }): Promise<number>;
    create(args: { data: InScope & { name: string; nameKey: string; sortOrder: number } }): Promise<PosCategoryRow>;
    updateMany(args: {
      where: InScope & { id: string };
      data: { name?: string; nameKey?: string; sortOrder?: number; archivedAt?: Date | null };
    }): Promise<{ count: number }>;
  };

  posItem: {
    findFirst(args: { where: InScope & ({ id: string } | { code: string }) }): Promise<PosItemRow | null>;
    findMany(args: {
      where: InScope & { archivedAt?: ArchivedFilter; id?: { in: string[] } };
      orderBy: Array<{ name: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<PosItemRow[]>;
    /** The live-item half of the count behind `pos:items`. */
    count(args: { where: InScope & { archivedAt: null } }): Promise<number>;
    create(args: { data: InScope & PosItemFields & { createdById: string; updatedById: string } }): Promise<PosItemRow>;
    updateMany(args: {
      where: InScope & { id: string };
      data: Partial<PosItemFields> & { archivedAt?: Date | null; updatedById: string };
    }): Promise<{ count: number }>;
  };

  posItemVariant: {
    findFirst(args: {
      where: InScope & ({ id: string; itemId?: string } | { code: string });
    }): Promise<PosItemVariantRow | null>;
    findMany(args: {
      where: InScope & { itemId?: string | { in: string[] }; archivedAt?: ArchivedFilter };
      orderBy: Array<{ sortOrder: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<PosItemVariantRow[]>;
    /**
     * The live-variant half of the count behind `pos:items`. ⚠ A variant of an
     * ARCHIVED item does not count: the item cannot be sold, and archiving it
     * must free its room.
     */
    count(args: { where: InScope & { archivedAt: null; item: { archivedAt: null } } }): Promise<number>;
    create(args: {
      data: InScope & {
        itemId: string;
        name: string;
        code: string | null;
        price: number;
        cost: number | null;
        sortOrder: number;
      };
    }): Promise<PosItemVariantRow>;
    updateMany(args: {
      where: InScope & { id: string; itemId: string };
      data: {
        name?: string;
        code?: string | null;
        price?: number;
        cost?: number | null;
        sortOrder?: number;
        archivedAt?: Date | null;
      };
    }): Promise<{ count: number }>;
  };

  posCustomer: {
    findFirst(args: { where: InScope & { id: string } }): Promise<PosCustomerRow | null>;
    findMany(args: {
      where: InScope & {
        archivedAt?: ArchivedFilter;
        OR?: Array<
          { name: { contains: string; mode: 'insensitive' } } | { contact: { contains: string; mode: 'insensitive' } }
        >;
      };
      orderBy: Array<{ name: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<PosCustomerRow[]>;
    create(args: {
      data: InScope & { name: string; contact: string | null; note: string | null; createdById: string };
    }): Promise<PosCustomerRow>;
    updateMany(args: {
      where: InScope & { id: string };
      data: { name?: string; contact?: string | null; note?: string | null; archivedAt?: Date | null };
    }): Promise<{ count: number }>;
  };

  posOrder: {
    findFirst(args: { where: InScope & ({ id: string } | { paymentClientId: string }) }): Promise<PosOrderRow | null>;
    findMany(args: {
      where: PosOrderListWhere;
      orderBy: Array<
        | { createdAt: SortOrder }
        | { paidAt: SortOrder }
        | { finalisedAt: SortOrder }
        | { number: SortOrder }
        | { id: SortOrder }
      >;
      take: number;
    }): Promise<PosOrderRow[]>;
    count(args: { where: PosOrderListWhere }): Promise<number>;
    create(args: { data: InScope & { createdById: string; label: string | null } }): Promise<PosOrderRow>;
    /**
     * ⚠ EVERY CHANGE IS A COMPARE-AND-SET ON `version` (and, where it matters,
     * `status`). Zero rows means somebody changed the order in between; the
     * caller refuses with a conflict rather than overwriting what it never saw.
     */
    updateMany(args: {
      where: InScope & { id: string; version: number; status?: PosOrderStatus };
      data: PosOrderUpdate;
    }): Promise<{ count: number }>;
  };

  posOrderLine: {
    findMany(args: {
      where: { orderId: string | { in: string[] } };
      orderBy: Array<{ orderId: SortOrder } | { position: SortOrder } | { id: SortOrder }>;
    }): Promise<PosOrderLineRow[]>;
    create(args: { data: PosOrderLineFields }): Promise<PosOrderLineRow>;
    updateMany(args: {
      where: { id: string; orderId: string };
      data: Partial<Omit<PosOrderLineFields, 'orderId' | 'organizationId' | 'workspaceId' | 'itemId'>>;
    }): Promise<{ count: number }>;
    /** Only lines of an OPEN order are ever removed: the service checks the order first. */
    deleteMany(args: { where: { id: string; orderId: string } }): Promise<{ count: number }>;
  };

  posRefund: {
    findFirst(args: { where: InScope & { clientId: string } }): Promise<PosRefundRow | null>;
    findMany(args: {
      where: (InScope & { orderId: string | { in: string[] } }) | (InScope & { refundedAt: { gte: Date; lt: Date } });
      orderBy: Array<{ refundedAt: SortOrder } | { id: SortOrder }>;
      take: number;
    }): Promise<PosRefundRow[]>;
    create(args: {
      data: InScope & {
        orderId: string;
        amount: number;
        method: PosPaymentMethod;
        reason: string;
        refundedById: string;
        clientId: string;
      };
    }): Promise<PosRefundRow>;
  };

  posRefundLine: {
    findMany(args: { where: { refundId: { in: string[] } } }): Promise<PosRefundLineRow[]>;
    create(args: {
      data: InScope & { refundId: string; orderLineId: string; quantity: number; amount: number };
    }): Promise<PosRefundLineRow>;
  };

  posCounter: {
    /**
     * ⚠ THE ORDER NUMBER, TAKEN ATOMICALLY: an upsert that increments, inside
     * the finalising transaction. Two tills finalising at once get two numbers
     * — the row lock orders them — and a rolled-back finalise gives its number
     * back, so numbers never skip.
     */
    upsert(args: {
      where: { workspaceId: string };
      create: InScope & { nextNumber: number };
      update: { nextNumber: { increment: 1 } };
    }): Promise<PosCounterRow>;
  };

  posSettings: {
    findUnique(args: { where: { workspaceId: string } }): Promise<PosSettingsRow | null>;
    upsert(args: {
      where: { workspaceId: string };
      create: InScope & { keymap: PosJsonInput; updatedById: string };
      update: { keymap: PosJsonInput; updatedById: string; version: { increment: 1 } };
    }): Promise<PosSettingsRow>;
  };
}

/**
 * JSON as Prisma accepts it for a nullable `Json` column. A keymap is
 * serialised to plain objects before it gets here; clearing it to "the
 * defaults" is done by writing the default map, never SQL NULL, so no
 * `Prisma.DbNull` sentinel is needed — and none is imported.
 */
export type PosJsonInput = { [key: string]: PosJsonInput } | PosJsonInput[] | string | number | boolean;

/** The read client. The same delegates; a host may bind a replica. */
export type PosPrismaClient = PosTransaction;

export interface PosWriteClient extends PosTransaction {
  $transaction<T>(fn: (tx: PosTransaction) => Promise<T>): Promise<T>;
}
