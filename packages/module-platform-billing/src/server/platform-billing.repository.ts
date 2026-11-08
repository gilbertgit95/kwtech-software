import type { DayKey } from '../domain/days.js';
import type { PaymentMethod } from '../domain/payments.js';
import type { RequestKind, RequestState } from '../domain/requests.js';

/**
 * The structural client billing reads and writes through: only the delegate
 * methods and argument shapes the services send. The app binds its Prisma
 * client to it (`apps/web-server/src/prisma/module-clients.ts`) and checks the
 * fit at compile time (`satisfies-modules.ts`). This module never imports
 * `@prisma/client` and opens no connection.
 */

type SortOrder = 'asc' | 'desc';

export type BillStatus = 'unpaid' | 'submitted' | 'paid' | 'cancelled';

export interface RequestRow {
  id: string;
  organizationId: string;
  kind: RequestKind;
  state: RequestState;
  planKey: string;
  fromPlanKey: string | null;
  pendingOrganizationId: string | null;
  requestedById: string;
  requestedAt: Date;
  pricedOn: Date;
  pricedForPeriodEnd: Date | null;
  detailsVersion: number;
  coveredOn: Date | null;
  holdDays: number;
  holdReason: string | null;
  accessUntilBeforeHold: Date | null;
  decidedById: string | null;
  decidedAt: Date | null;
  decisionReason: string | null;
  selfApproved: boolean;
  approverIsMember: boolean;
  periodStart: Date | null;
  periodEnd: Date | null;
  billingDay: number | null;
  accessUntil: Date | null;
  subscriptionId: string | null;
  /** How the approval wrote the subscription (`AppliedHow`), and the live row before it: what a void reverses. */
  applied: string | null;
  subscriptionBefore: unknown;
  restoredSubscriptionId: string | null;
  voidedById: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  updatedAt: Date;
}

export interface PaymentRow {
  id: string;
  requestId: string;
  version: number;
  method: PaymentMethod;
  amount: number;
  paidOn: Date;
  reference: string | null;
  referenceNormalised: string | null;
  sender: string | null;
  note: string | null;
  source: string;
  enteredById: string;
  enteredAt: Date;
}

export interface BillRow {
  id: string;
  requestId: string;
  organizationId: string;
  number: number;
  status: BillStatus;
  total: number;
  currency: string;
  /** A `BillSnapshot`, as stored. Read back through `readBillSnapshot`. */
  snapshot: unknown;
  issuedAt: Date;
  cancelledAt: Date | null;
  cancelledReason: string | null;
}

export interface ReceiptRow {
  id: string;
  requestId: string;
  billId: string | null;
  organizationId: string;
  number: number;
  amount: number;
  currency: string;
  method: PaymentMethod;
  kind: string;
  snapshot: unknown;
  issuedAt: Date;
  issuedById: string;
  voidedAt: Date | null;
  voidedById: string | null;
  voidReason: string | null;
}

export interface CreditRow {
  id: string;
  organizationId: string;
  amount: number;
  kind: string;
  requestId: string | null;
  billId: string | null;
  receiptId: string | null;
  subscriptionId: string | null;
  note: string | null;
  createdById: string | null;
  createdAt: Date;
}

export interface PriceRowStored {
  id: string;
  planKey: string;
  monthly: number;
  effectiveFrom: Date;
  setById: string;
  createdAt: Date;
}

export interface SettingsRow {
  id: string;
  currency: string;
  timeZone: string;
  graceDays: number;
  issuerName: string;
  issuerDetails: string;
  paymentAccounts: unknown;
  updatedById: string | null;
  updatedAt: Date;
}

/** A notice the daily check owes (`PlatformBillingNotice`). */
export interface NoticeRow {
  id: string;
  organizationId: string;
  kind: string;
  periodKey: string;
  day: Date;
  data: unknown;
  createdAt: Date;
  sentAt: Date | null;
}

export interface CounterRow {
  sequence: string;
  value: number;
}

export interface EventRow {
  id: string;
  requestId: string;
  organizationId: string;
  at: Date;
  actorId: string | null;
  step: string;
  reason: string | null;
  data: unknown;
}

/** A value inside a JSON column: plain data only, so a `Date` never reaches one unconverted. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** What a JSON column is written with. Never a bare `null` at the top: Prisma reads that as "no value". */
export type JsonInput = string | number | boolean | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface RequestUpdate {
  state?: RequestState;
  pendingOrganizationId?: null;
  detailsVersion?: number;
  coveredOn?: Date | null;
  holdDays?: number;
  holdReason?: string | null;
  accessUntilBeforeHold?: Date;
  decidedById?: string;
  decidedAt?: Date;
  decisionReason?: string | null;
  selfApproved?: boolean;
  approverIsMember?: boolean;
  periodStart?: Date;
  periodEnd?: Date;
  billingDay?: number;
  accessUntil?: Date;
  subscriptionId?: string;
  applied?: string;
  /**
   * `SubscriptionBefore`. Left out when nothing was live, so the column stays
   * SQL NULL: Prisma refuses a plain `null` for a JSON column (it would have
   * to choose between `DbNull` and `JsonNull`, which this module cannot import).
   */
  subscriptionBefore?: JsonInput;
  voidedById?: string;
  voidedAt?: Date;
  voidReason?: string;
}

export interface PlatformBillingTransaction {
  platformBillingRequest: {
    findFirst(args: {
      where: {
        id?: string;
        organizationId?: string;
        state?: RequestState;
        kind?: RequestKind | { not: RequestKind };
        pricedForPeriodEnd?: Date;
        periodEnd?: Date;
        subscriptionId?: string;
        restoredSubscriptionId?: string;
        /** Decided after an instant: an adjustment made since an approval (a void's check). */
        decidedAt?: { gt: Date };
        /** Made before an instant: a request waiting too long (the approvers' digest). */
        requestedAt?: { lt: Date };
      };
      orderBy?: { requestedAt: SortOrder } | { decidedAt: SortOrder };
    }): Promise<RequestRow | null>;
    /** How many requests wait past a day, for the approvers' digest: a count, never the rows. */
    /** Requests waiting past a day (the approvers' digest), or the history's matches (its count): never the rows. */
    count(args: {
      where: { state: 'pending'; requestedAt: { lt: Date } } | ({ organizationId: string } & HistoryFilterWhere);
    }): Promise<number>;
    findMany(args: {
      /** A page of an organization's history or of the queue, or the pending requests naming a plan (an archive). */
      where: {
        organizationId?: string;
        state?: RequestState | { notIn: RequestState[] };
        planKey?: string;
        fromPlanKey?: string;
        kind?: RequestKind;
        /** A year of the history, in the billing time zone. */
        requestedAt?: { gte: Date; lt: Date };
        /** The requests a page of receipts belongs to (the collections report: what each payment bought). */
        id?: { in: string[] };
      };
      orderBy: Array<{ requestedAt: SortOrder } | { id: SortOrder }>;
      take: number;
      cursor?: { id: string };
      skip?: number;
    }): Promise<RequestRow[]>;
    create(args: {
      data: {
        organizationId: string;
        kind: RequestKind;
        planKey: string;
        fromPlanKey: string | null;
        /** The organization's id while pending; null for a request recorded already decided (an adjustment). */
        pendingOrganizationId: string | null;
        requestedById: string;
        requestedAt: Date;
        pricedOn: Date;
        pricedForPeriodEnd: Date | null;
      };
    }): Promise<RequestRow>;
    /**
     * ⚠ EVERY DECISION IS A COMPARE-AND-SET while still `pending` (and, for an
     * approval, on the details version the approver saw). Zero rows: somebody
     * decided first, or the details changed; the caller reads again to say which.
     */
    updateMany(args: {
      /** ⚠ Always conditional on the state: the compare-and-set every decision makes. */
      where: { id: string; state: 'pending' | 'approved'; detailsVersion?: number };
      data: RequestUpdate;
    }): Promise<{ count: number }>;
    /** Only after the compare-and-set above has decided the request: a link written in the same transaction. */
    update(args: {
      where: { id: string };
      data: { subscriptionId: string } | { restoredSubscriptionId: string };
    }): Promise<RequestRow>;
  };

  platformBillingPayment: {
    findFirst(args: { where: { requestId: string }; orderBy: { version: SortOrder } }): Promise<PaymentRow | null>;
    findMany(args: {
      where: { requestId?: { in: string[] }; referenceNormalised?: string };
      orderBy: Array<{ enteredAt: SortOrder } | { version: SortOrder }>;
      take?: number;
    }): Promise<PaymentRow[]>;
    create(args: {
      data: {
        requestId: string;
        version: number;
        method: PaymentMethod;
        amount: number;
        paidOn: Date;
        reference: string | null;
        referenceNormalised: string | null;
        sender: string | null;
        note: string | null;
        source: string;
        enteredById: string;
        enteredAt: Date;
      };
    }): Promise<PaymentRow>;
  };

  platformBillingBill: {
    findFirst(args: {
      where: { requestId?: string; organizationId?: string; status?: { not: BillStatus } };
      orderBy?: { number: SortOrder };
    }): Promise<BillRow | null>;
    findMany(args: {
      /** A page of requests' bills, or an organization's bills issued in a range (the statement). */
      where: { requestId: { in: string[] } } | { organizationId: string; issuedAt: { gte: Date; lt: Date } };
      orderBy: { number: SortOrder };
    }): Promise<BillRow[]>;
    count(args: { where: Record<string, never> }): Promise<number>;
    create(args: {
      data: {
        requestId: string;
        organizationId: string;
        number: number;
        status: BillStatus;
        total: number;
        currency: string;
        /** A `BillSnapshot`: plain data, written once. */
        snapshot: object;
        issuedAt: Date;
      };
    }): Promise<BillRow>;
    update(args: {
      where: { id: string };
      data: { status: BillStatus; cancelledAt?: Date | null; cancelledReason?: string | null };
    }): Promise<BillRow>;
  };

  platformBillingReceipt: {
    findMany(args: {
      /** A page of requests' receipts, or an organization's receipts issued in a range (the statement). */
      where:
        | { requestId: { in: string[] } }
        | { organizationId: string; issuedAt: { gte: Date; lt: Date } }
        /** Every organization's receipts that stand, issued in a range (the platform's collections report). */
        | { issuedAt: { gte: Date; lt: Date }; voidedAt: null };
      orderBy: { number: SortOrder };
    }): Promise<ReceiptRow[]>;
    /** Money received in a range (the history's totals): receipts that stand, a count and a sum. */
    aggregate(args: {
      where: { organizationId: string; issuedAt: { gte: Date; lt: Date }; voidedAt: null };
      _sum: { amount: true };
    }): Promise<{ _sum: { amount: number | null } }>;
    findFirst(args: {
      where: { requestId: string; kind?: string; voidedAt?: null };
      orderBy: { number: SortOrder };
    }): Promise<ReceiptRow | null>;
    update(args: {
      where: { id: string };
      data: { voidedAt: Date; voidedById: string; voidReason: string };
    }): Promise<ReceiptRow>;
    create(args: {
      data: {
        requestId: string;
        billId: string | null;
        organizationId: string;
        number: number;
        amount: number;
        currency: string;
        method: PaymentMethod;
        kind: string;
        /** A `ReceiptSnapshot`: plain data, written once. */
        snapshot: object;
        issuedAt: Date;
        issuedById: string;
      };
    }): Promise<ReceiptRow>;
  };

  platformBillingCredit: {
    /** The balance is the sum of the ledger: never a stored number that could drift from it. */
    /** The balance, or the balance before a day (a statement's opening credit). */
    aggregate(args: { where: { organizationId: string; createdAt?: { lt: Date } }; _sum: { amount: true } }): Promise<{
      _sum: { amount: number | null };
    }>;
    findMany(args: {
      /**
       * A receipt's entries (a void), a subscription's archive entries (an
       * archive once, its reversal), or an organization's entries in a range
       * (the statement).
       */
      where:
        | { receiptId: string }
        | { subscriptionId: string; kind: { in: string[] } }
        | { organizationId: string; createdAt: { gte: Date; lt: Date } };
      orderBy: { createdAt: SortOrder };
    }): Promise<CreditRow[]>;
    create(args: {
      data: {
        organizationId: string;
        amount: number;
        kind: string;
        requestId: string | null;
        billId: string | null;
        receiptId: string | null;
        subscriptionId?: string | null;
        note: string | null;
        createdById: string | null;
        createdAt: Date;
      };
    }): Promise<CreditRow>;
  };

  platformBillingPrice: {
    findMany(args: {
      orderBy: Array<{ planKey: SortOrder } | { effectiveFrom: SortOrder }>;
    }): Promise<PriceRowStored[]>;
    upsert(args: {
      where: { planKey_effectiveFrom: { planKey: string; effectiveFrom: Date } };
      create: { planKey: string; monthly: number; effectiveFrom: Date; setById: string };
      update: { monthly: number; setById: string };
    }): Promise<PriceRowStored>;
  };

  platformBillingSettings: {
    findUnique(args: { where: { id: string } }): Promise<SettingsRow | null>;
    upsert(args: {
      where: { id: string };
      create: SettingsWrite & { id: string };
      update: SettingsWrite;
    }): Promise<SettingsRow>;
  };

  /** The organization's decision lock (`PlatformBillingLock`): upserted first by every billing write. */
  platformBillingLock: {
    upsert(args: {
      where: { organizationId: string };
      create: { organizationId: string; version: number };
      update: { version: { increment: number } };
    }): Promise<{ organizationId: string; version: number }>;
  };

  /** The daily check's notices: written before sending, marked sent after. */
  platformBillingNotice: {
    create(args: {
      data: { organizationId: string; kind: string; periodKey: string; day: Date; data: JsonInput; createdAt: Date };
    }): Promise<NoticeRow>;
    /** The unsent notices still worth sending (written after `createdAt.gt`), oldest first. */
    findMany(args: {
      where: { sentAt: null; createdAt: { gt: Date } };
      orderBy: { createdAt: SortOrder };
      take: number;
    }): Promise<NoticeRow[]>;
    /** The unsent notices too old to send now, counted for the log. */
    count(args: { where: { sentAt: null; createdAt: { lte: Date } } }): Promise<number>;
    update(args: { where: { id: string }; data: { sentAt: Date } }): Promise<NoticeRow>;
  };

  platformBillingCounter: {
    /**
     * ⚠ THE GAPLESS NUMBER: an UPDATE inside the issuing transaction. The row
     * lock holds a second issuer until the first commits; a rollback returns
     * the number. Upserted so a fresh database needs no seed row.
     */
    upsert(args: {
      where: { sequence: string };
      create: { sequence: string; value: number };
      update: { value: { increment: number } };
    }): Promise<CounterRow>;
  };

  platformBillingEvent: {
    findMany(args: {
      where: { requestId: { in: string[] } };
      orderBy: Array<{ at: SortOrder } | { id: SortOrder }>;
    }): Promise<EventRow[]>;
    create(args: {
      data: {
        requestId: string;
        organizationId: string;
        at: Date;
        actorId: string | null;
        step: string;
        reason: string | null;
        data: JsonInput;
      };
    }): Promise<EventRow>;
  };
}

/** What a settings write sets. */
/** The history's filters as a `where` (`PlatformBillingService.history`). */
export interface HistoryFilterWhere {
  state?: RequestState | { notIn: RequestState[] };
  requestedAt?: { gte: Date; lt: Date };
}

export interface SettingsWrite {
  currency?: string;
  timeZone?: string;
  graceDays?: number;
  issuerName?: string;
  issuerDetails?: string;
  paymentAccounts?: JsonInput;
  updatedById: string;
}

/** The read client: the same delegates. Reads go through it so a host may point them at a replica. */
export type PlatformBillingPrismaClient = PlatformBillingTransaction;

/** The write client, with the interactive transaction. */
export interface PlatformBillingWriteClient extends PlatformBillingTransaction {
  $transaction<T>(fn: (tx: PlatformBillingTransaction) => Promise<T>): Promise<T>;
}

/**
 * A DATE column's value as a day. Prisma reads `@db.Date` as midnight UTC of
 * that calendar day, so the UTC date IS the day: no zone is involved, and
 * reading it in Manila would move it. The one place a `Date` becomes a day key
 * without the platform's zone, and why.
 */
export function dateColumnToDay(value: Date): DayKey {
  return value.toISOString().slice(0, 10);
}

/** A day as a DATE column's value: midnight UTC of that calendar day (see `dateColumnToDay`). */
export function dayToDateColumn(day: DayKey): Date {
  return new Date(`${day}T00:00:00.000Z`);
}
