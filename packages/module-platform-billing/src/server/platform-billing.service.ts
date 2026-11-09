import { DEFAULT_TIME_ZONE } from '@kwtech/module-kit';
import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_GRACE_DAYS } from '../domain/access.js';
import { buildPlanComparison, type PlanComparison } from '../domain/comparison.js';
import { addDays, type DayKey, platformDay, platformDayStart } from '../domain/days.js';
import type { Issuer } from '../domain/documents.js';
import type { Centavos } from '../domain/money.js';
import { checkAmount, findReferenceReuse } from '../domain/payments.js';
import { type CapOverrun, capsBlockingDowngrade } from '../domain/plans.js';
import { isRefused, type PricedRequest, priceRequest } from '../domain/pricing.js';
import type { Quote } from '../domain/quotes.js';
import type { PlatformBillingRefusal } from '../domain/refusals.js';
import { checkNewRequest, type PricedKind, type RequestState } from '../domain/requests.js';
import {
  type BillingStanding,
  billingStanding,
  hasAnyPrice,
  type PriceRow,
  requestStanding,
  type SubscriptionDays,
} from '../domain/standing.js';
import {
  buildStatement,
  checkStatementRange,
  HISTORY_STATES,
  type HistoryFilter,
  type HistoryTotals,
  isHistoryYear,
  STATEMENT_MAX_DAYS,
  type Statement,
} from '../domain/statement.js';
import { billingRefusal } from './platform-billing.errors.js';
import {
  type BillRow,
  dateColumnToDay,
  dayToDateColumn,
  type EventRow,
  type HistoryFilterWhere,
  type PaymentRow,
  type PlatformBillingPrismaClient,
  type PlatformBillingTransaction,
  type ReceiptRow,
  type RequestRow,
} from './platform-billing.repository.js';
import {
  PLATFORM_BILLING_PLANS,
  PLATFORM_BILLING_PRISMA,
  PLATFORM_BILLING_SUBSCRIPTIONS,
} from './platform-billing.tokens.js';
import type {
  BillingPlan,
  BillingSubscriptionRow,
  PlatformBillingPlans,
  PlatformBillingSubscriptions,
} from './ports.js';

/** The one settings row's id (D17: one platform, one currency, one clock). */
export const PLATFORM_BILLING_SETTINGS_ID = 'platform';

/** A history page's size when the caller names none, and the most one page returns. */
export const PLATFORM_BILLING_PAGE_DEFAULT = 20;
export const PLATFORM_BILLING_PAGE_MAX = 100;

/** Where organizations pay, as the Billing page lists it. */
export interface PaymentAccount {
  method: string;
  label: string;
  details: string;
}

/** The settings in force: the row, or the defaults when nobody has saved one. */
export interface BillingSettings {
  currency: string;
  timeZone: string;
  graceDays: number;
  issuer: Issuer;
  paymentAccounts: readonly PaymentAccount[];
}

/** Everything a request decision reads about one organization, read once. */
export interface BillingContext {
  organizationId: string;
  settings: BillingSettings;
  today: DayKey;
  prices: readonly PriceRow[];
  plans: ReadonlyMap<string, BillingPlan>;
  live: BillingSubscriptionRow | null;
  liveDays: SubscriptionDays | null;
  standing: BillingStanding;
  creditBalance: Centavos;
  pending: RequestRow | null;
  /**
   * The owner cancelled the live row's period: an approved cancel of THIS row
   * and THIS period end. A renewal moves the period on and a plan change
   * starts a new row, so either leaves the cancel behind without a write.
   */
  cancelled: boolean;
  /** The owner's auto-renew switch (#129): off when no row was ever written. */
  autoRenew: { enabled: boolean; setAt: Date | null };
}

/** A request with what hangs off it: one row of the history (plan §7). */
export interface RequestDetail {
  request: RequestRow;
  bills: readonly BillRow[];
  receipts: readonly ReceiptRow[];
  payments: readonly PaymentRow[];
  events: readonly EventRow[];
}

/** What a pending request shows an approver: checks that flag, never decide (plan §4). */
export interface QueueFlags {
  /** Other requests whose payment carries the same reference (normalised). */
  referenceUsedOn: readonly string[];
  /** The latest details against the bill: `exact`, `short`, `over`, or `none` when there are no details. */
  amount: 'exact' | 'short' | 'over' | 'none';
  amountDifference: Centavos;
  missingDetails: boolean;
  holdInForce: boolean;
  /** The viewer made this request: approving it is a self-approval. */
  selfRequest: boolean;
  /** The viewer is a member of the organization (D15). */
  viewerIsMember: boolean;
}

/** A preview of a request: the price, or the reason it cannot be made, and the caps in the way. */
export interface RequestPreview {
  priced: PricedRequest | null;
  refused: PlatformBillingRefusal | null;
  overruns: readonly CapOverrun[];
}

/**
 * The reads every organization's context shares: read once by a walk over
 * many organizations (the platform's standings), never by a decision, which
 * reads them again inside its own transaction.
 */
export interface SharedBillingReads {
  settings: BillingSettings;
  prices: readonly PriceRow[];
  plans: ReadonlyMap<string, BillingPlan>;
}

/**
 * Every read billing makes. The write service reads through the same methods,
 * passing its transaction, so a decision and the page that explains it are
 * worked out from one account of the organization.
 */
@Injectable()
export class PlatformBillingService {
  constructor(
    @Inject(PLATFORM_BILLING_PRISMA) private readonly prisma: PlatformBillingPrismaClient,
    @Inject(PLATFORM_BILLING_SUBSCRIPTIONS) private readonly subscriptions: PlatformBillingSubscriptions,
    @Inject(PLATFORM_BILLING_PLANS) private readonly plansPort: PlatformBillingPlans,
  ) {}

  /** The settings in force. Defaults until a super admin saves the row. */
  async settings(db: PlatformBillingTransaction = this.prisma): Promise<BillingSettings> {
    const row = await db.platformBillingSettings.findUnique({ where: { id: PLATFORM_BILLING_SETTINGS_ID } });
    return {
      currency: row?.currency ?? 'PHP',
      timeZone: row?.timeZone ?? DEFAULT_TIME_ZONE,
      graceDays: row?.graceDays ?? DEFAULT_GRACE_DAYS,
      issuer: { name: row?.issuerName ?? '', details: row?.issuerDetails ?? '' },
      paymentAccounts: readPaymentAccounts(row?.paymentAccounts),
    };
  }

  /** Every price row, as days. */
  async prices(db: PlatformBillingTransaction = this.prisma): Promise<readonly PriceRow[]> {
    const rows = await db.platformBillingPrice.findMany({ orderBy: [{ planKey: 'asc' }, { effectiveFrom: 'asc' }] });
    return rows.map((row) => ({
      planKey: row.planKey,
      monthly: row.monthly,
      effectiveFrom: dateColumnToDay(row.effectiveFrom),
    }));
  }

  /** The stored price rows, for the settings page. */
  async priceRows(): Promise<
    ReadonlyArray<{ planKey: string; monthly: number; effectiveFrom: DayKey; setById: string }>
  > {
    const rows = await this.prisma.platformBillingPrice.findMany({
      orderBy: [{ planKey: 'asc' }, { effectiveFrom: 'asc' }],
    });
    return rows.map((row) => ({
      planKey: row.planKey,
      monthly: row.monthly,
      effectiveFrom: dateColumnToDay(row.effectiveFrom),
      setById: row.setById,
    }));
  }

  /** The organization's credit balance: the ledger's sum. Negative is owed (plan §4). */
  async creditBalance(organizationId: string, db: PlatformBillingTransaction = this.prisma): Promise<Centavos> {
    const sum = await db.platformBillingCredit.aggregate({ where: { organizationId }, _sum: { amount: true } });
    return sum._sum.amount ?? 0;
  }

  /** Whether any bill was ever issued: what locks the currency and the time zone (D16). */
  async billed(db: PlatformBillingTransaction = this.prisma): Promise<boolean> {
    return (await db.platformBillingBill.count({ where: {} })) > 0;
  }

  /** Every plan, by key. */
  async plans(): Promise<ReadonlyMap<string, BillingPlan>> {
    return new Map((await this.plansPort.plans()).map((plan) => [plan.key, plan]));
  }

  /** The caps `organizationId` is over on `plan` (D6). */
  async overruns(organizationId: string, plan: BillingPlan): Promise<readonly CapOverrun[]> {
    return capsBlockingDowngrade(await this.plansPort.usage(organizationId), plan);
  }

  /** Everything a decision about `organizationId` reads, on `now`, inside `db` when a write passes its transaction. */
  async context(
    organizationId: string,
    now: Date,
    db: PlatformBillingTransaction = this.prisma,
    shared?: SharedBillingReads,
  ): Promise<BillingContext> {
    const isWrite = db !== this.prisma;
    const [settings, prices, plans, live, creditBalance, pending, autoRenew] = await Promise.all([
      shared?.settings ?? this.settings(db),
      shared?.prices ?? this.prices(db),
      shared?.plans ?? this.plans(),
      this.subscriptions.live(organizationId, isWrite ? db : undefined),
      this.creditBalance(organizationId, db),
      db.platformBillingRequest.findFirst({ where: { organizationId, state: 'pending' } }),
      db.platformBillingAutoRenew.findUnique({ where: { organizationId } }),
    ]);
    const today = platformDay(now, settings.timeZone);
    const liveDays = live ? subscriptionDays(live, settings.timeZone) : null;
    const standing = billingStanding(
      liveDays,
      today,
      settings.graceDays,
      live ? hasAnyPrice(prices, live.planKey) : false,
    );
    const cancel =
      live && standing.rowPeriod
        ? await db.platformBillingRequest.findFirst({
            where: {
              organizationId,
              state: 'approved',
              kind: 'cancel',
              subscriptionId: live.subscriptionId,
              periodEnd: dayToDateColumn(standing.rowPeriod.end),
            },
          })
        : null;
    return {
      organizationId,
      settings,
      today,
      prices,
      plans,
      live,
      liveDays,
      standing,
      creditBalance,
      pending,
      cancelled: cancel !== null,
      autoRenew: { enabled: autoRenew?.enabled ?? false, setAt: autoRenew?.setAt ?? null },
    };
  }

  /**
   * The renewal the organization's credit would pay today (#129), priced as a
   * renewal request is, or why it cannot be: what the daily check renews from,
   * and what "next renewal paid from credit" on the Billing page says.
   */
  renewalFromCredit(context: BillingContext): Quote | { refused: PlatformBillingRefusal } {
    const priced = priceRequest({
      kind: 'renew',
      planKey: context.live?.planKey ?? '',
      currentPlanKey: context.live?.planKey ?? null,
      standing: context.standing,
      prices: context.prices,
      creditBalance: context.creditBalance,
      day: context.today,
    });
    return isRefused(priced) ? priced : priced.quote;
  }

  /**
   * The plans side by side for the organization (#101): every public plan on
   * offer and its own, today's prices, and what each includes. Built from the
   * same rows the caps and features are enforced from.
   */
  comparison(context: BillingContext): PlanComparison {
    return buildPlanComparison({
      plans: [...context.plans.values()],
      prices: context.prices,
      today: context.today,
      currentPlanKey: context.live?.planKey ?? null,
      labels: this.plansPort.labels?.() ?? { features: [], limits: [] },
    });
  }

  /**
   * Whether `kind` on `planKey` may be requested now, and what it would cost:
   * the check `submit` runs, as a preview the page shows before anyone presses
   * Request.
   */
  async preview(
    context: BillingContext,
    kind: PricedKind,
    planKey: string | null,
    months = 1,
  ): Promise<RequestPreview> {
    const currentPlanKey = context.live?.planKey ?? null;
    const wanted = kind === 'renew' ? currentPlanKey : planKey;
    const plan = wanted ? (context.plans.get(wanted) ?? null) : null;
    // The caps are counted only for a plan someone chooses; a renewal keeps what it has.
    const overruns = plan && kind !== 'renew' ? await this.overruns(context.organizationId, plan) : [];
    const refused = checkNewRequest({
      kind,
      // ⚠ The guard already proved it: subscribe, change and replace are bound
      // to `platform-billing:change_plan`, which only the owner's role holds (D8).
      actorIsOwner: true,
      standing: requestStanding(
        context.standing,
        context.liveDays,
        context.today,
        context.pending !== null,
        context.cancelled,
      ),
      currentPlanKey,
      plan: plan ? { key: plan.key, isPublic: plan.isPublic, archived: plan.archived } : null,
      overCaps: overruns.length,
    });
    if (refused || !wanted) return { priced: null, refused: refused ?? 'not_found', overruns };
    const priced = priceRequest({
      kind,
      planKey: wanted,
      currentPlanKey,
      standing: context.standing,
      prices: context.prices,
      creditBalance: context.creditBalance,
      day: context.today,
      months,
    });
    if (isRefused(priced)) return { priced: null, refused: priced.refused, overruns };
    return { priced, refused: null, overruns };
  }

  /** One request of `organizationId`, with its documents and timeline. Null for one in another organization. */
  async organizationRequest(organizationId: string, requestId: string): Promise<RequestDetail | null> {
    const request = await this.prisma.platformBillingRequest.findFirst({ where: { id: requestId, organizationId } });
    if (!request) return null;
    return (await this.details([request]))[0] ?? null;
  }

  /** Any request, for platform staff. */
  async anyRequest(requestId: string): Promise<RequestDetail | null> {
    const request = await this.prisma.platformBillingRequest.findFirst({ where: { id: requestId } });
    if (!request) return null;
    return (await this.details([request]))[0] ?? null;
  }

  /** The organization's history, newest first: one row per request (plan §7). */
  async history(
    organizationId: string,
    cursor: string | null,
    limit: number | null,
    filter: HistoryFilter = {},
  ): Promise<{ items: readonly RequestDetail[]; nextCursor: string | null; totals: HistoryTotals }> {
    const settings = await this.settings();
    const where = historyWhere(filter, settings.timeZone);
    const [page, count, paid] = await Promise.all([
      this.page({ organizationId, ...where }, cursor, limit),
      this.prisma.platformBillingRequest.count({ where: { organizationId, ...where } }),
      where.requestedAt
        ? this.prisma.platformBillingReceipt.aggregate({
            where: { organizationId, issuedAt: where.requestedAt, voidedAt: null },
            _sum: { amount: true },
          })
        : null,
    ]);
    return { ...page, totals: { requests: count, paidInYear: paid ? (paid._sum.amount ?? 0) : null } };
  }

  /**
   * The statement of account for the days `from` to `to` (both included, in
   * the billing time zone; plan §7): every bill, receipt and credit entry in
   * the range, oldest first, the credit balance before and after, and what
   * was billed and paid. A cancelled bill and a voided receipt are listed
   * and say so, but count for nothing in the totals.
   */
  async statement(organizationId: string, from: string, to: string): Promise<Statement> {
    const refused = checkStatementRange(from, to);
    if (refused) throw billingRefusal(refused, { field: 'range', maxDays: STATEMENT_MAX_DAYS });
    const settings = await this.settings();
    const range = {
      gte: platformDayStart(from, settings.timeZone),
      lt: platformDayStart(addDays(to, 1), settings.timeZone),
    };
    const [bills, receipts, credits, before] = await Promise.all([
      this.prisma.platformBillingBill.findMany({
        where: { organizationId, issuedAt: range },
        orderBy: { number: 'asc' },
      }),
      this.prisma.platformBillingReceipt.findMany({
        where: { organizationId, issuedAt: range },
        orderBy: { number: 'asc' },
      }),
      this.prisma.platformBillingCredit.findMany({
        where: { organizationId, createdAt: range },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.platformBillingCredit.aggregate({
        where: { organizationId, createdAt: { lt: range.gte } },
        _sum: { amount: true },
      }),
    ]);
    return buildStatement({
      from,
      to,
      currency: settings.currency,
      timeZone: settings.timeZone,
      openingCredit: before._sum.amount ?? 0,
      bills,
      receipts,
      credits,
    });
  }

  /** Every pending request, oldest first, for the platform queue. */
  async pendingRequests(
    cursor: string | null,
    limit: number | null,
  ): Promise<{ items: readonly RequestDetail[]; nextCursor: string | null }> {
    return this.page({ state: 'pending' }, cursor, limit, 'asc');
  }

  /** Every decided request, newest first, for the platform: where an approval to void is found. */
  async decidedRequests(
    cursor: string | null,
    limit: number | null,
  ): Promise<{ items: readonly RequestDetail[]; nextCursor: string | null }> {
    return this.page({ state: { notIn: ['pending'] } }, cursor, limit, 'desc');
  }

  /** The checks an approver sees on a pending request (plan §4). */
  async flags(detail: RequestDetail, viewerId: string, viewerIsMember: boolean): Promise<QueueFlags> {
    const latest = latestPayment(detail.payments);
    const bill = openBill(detail.bills);
    let referenceUsedOn: readonly string[] = [];
    if (latest?.referenceNormalised) {
      const others = await this.prisma.platformBillingPayment.findMany({
        where: { referenceNormalised: latest.referenceNormalised },
        orderBy: [{ enteredAt: 'asc' }],
        take: 50,
      });
      const uses = others.map((other) => ({
        requestId: other.requestId,
        organizationId: '',
        reference: other.reference ?? '',
      }));
      referenceUsedOn = [
        ...new Set(findReferenceReuse(latest.reference ?? '', detail.request.id, uses).map((use) => use.requestId)),
      ];
    }
    const check = latest && bill ? checkAmount(latest.amount, bill.total) : null;
    return {
      referenceUsedOn,
      amount: check?.kind ?? 'none',
      amountDifference: check && check.kind !== 'exact' ? check.by : 0,
      missingDetails: !latest,
      holdInForce: detail.request.holdDays > 0,
      selfRequest: detail.request.requestedById === viewerId,
      viewerIsMember,
    };
  }

  /** One keyset page of requests, with their documents. */
  private async page(
    where:
      | { organizationId?: string; state?: 'pending' | { notIn: RequestState[] } }
      | ({ organizationId: string } & HistoryFilterWhere),
    cursor: string | null,
    limit: number | null,
    order: 'asc' | 'desc' = 'desc',
  ): Promise<{ items: readonly RequestDetail[]; nextCursor: string | null }> {
    const take = Math.min(Math.max(limit ?? PLATFORM_BILLING_PAGE_DEFAULT, 1), PLATFORM_BILLING_PAGE_MAX);
    const rows = await this.prisma.platformBillingRequest.findMany({
      where,
      orderBy: [{ requestedAt: order }, { id: order }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const items = await this.details(rows.slice(0, take));
    return { items, nextCursor: rows.length > take ? (rows[take - 1]?.id ?? null) : null };
  }

  /** The documents and timeline of each request, read in four queries for the page. */
  private async details(requests: readonly RequestRow[]): Promise<RequestDetail[]> {
    if (requests.length === 0) return [];
    const ids = requests.map((request) => request.id);
    const [bills, receipts, payments, events] = await Promise.all([
      this.prisma.platformBillingBill.findMany({ where: { requestId: { in: ids } }, orderBy: { number: 'asc' } }),
      this.prisma.platformBillingReceipt.findMany({ where: { requestId: { in: ids } }, orderBy: { number: 'asc' } }),
      this.prisma.platformBillingPayment.findMany({ where: { requestId: { in: ids } }, orderBy: [{ version: 'asc' }] }),
      this.prisma.platformBillingEvent.findMany({
        where: { requestId: { in: ids } },
        orderBy: [{ at: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return requests.map((request) => ({
      request,
      bills: bills.filter((row) => row.requestId === request.id),
      receipts: receipts.filter((row) => row.requestId === request.id),
      payments: payments.filter((row) => row.requestId === request.id),
      events: events.filter((row) => row.requestId === request.id),
    }));
  }
}

/** The live row as platform days. */
export function subscriptionDays(row: BillingSubscriptionRow, timeZone: string): SubscriptionDays {
  return {
    planKey: row.planKey,
    planArchived: row.planArchived,
    periodStart: row.periodStart ? platformDay(row.periodStart, timeZone) : null,
    periodEnd: row.currentPeriodEnd ? platformDay(row.currentPeriodEnd, timeZone) : null,
    billingDay: row.billingDay,
    accessUntil: row.accessUntil ? platformDay(row.accessUntil, timeZone) : null,
    trial: row.trial,
  };
}

/** The newest version of the payment details, or null. */
export function latestPayment(payments: readonly PaymentRow[]): PaymentRow | null {
  return payments.reduce<PaymentRow | null>(
    (latest, row) => (!latest || row.version > latest.version ? row : latest),
    null,
  );
}

/** The request's bill in force: the newest one not cancelled. */
export function openBill(bills: readonly BillRow[]): BillRow | null {
  return bills
    .filter((bill) => bill.status !== 'cancelled')
    .reduce<BillRow | null>((latest, bill) => (!latest || bill.number > latest.number ? bill : latest), null);
}

/** The stored accounts list, keeping only well-formed entries: a hand-edited row never breaks the page. */
function readPaymentAccounts(value: unknown): PaymentAccount[] {
  if (!Array.isArray(value)) return [];
  const accounts: PaymentAccount[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { method, label, details } = entry as Record<string, unknown>;
    if (typeof method === 'string' && typeof label === 'string' && typeof details === 'string') {
      accounts.push({ method, label, details });
    }
  }
  return accounts;
}

/**
 * The history's filters as a query: a year as its range in the billing time
 * zone, one state, or the requests that changed nothing hidden. A state or a
 * year the filter cannot name is ignored, never passed on.
 */
export function historyWhere(filter: HistoryFilter, timeZone: string): HistoryFilterWhere {
  const where: HistoryFilterWhere = {};
  if (typeof filter.year === 'number' && isHistoryYear(filter.year)) {
    where.requestedAt = {
      gte: platformDayStart(`${filter.year}-01-01`, timeZone),
      lt: platformDayStart(`${filter.year + 1}-01-01`, timeZone),
    };
  }
  const state = filter.state && (HISTORY_STATES as readonly string[]).includes(filter.state) ? filter.state : null;
  if (state) where.state = state as RequestState;
  else if (filter.hideClosed) where.state = { notIn: ['withdrawn', 'rejected'] };
  return where;
}
