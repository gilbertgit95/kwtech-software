import { paidUpTo } from '../../domain/auto-renew.js';
import { readBillSnapshot } from '../../domain/documents.js';
import { isRefused, priceRequest } from '../../domain/pricing.js';
import type { QuoteLine } from '../../domain/quotes.js';
import { refusalText } from '../../domain/refusals.js';
import { documentNumber, priceOn } from '../../domain/standing.js';
import { type BillRow, dateColumnToDay } from '../platform-billing.repository.js';
import type { RequestPreview } from '../platform-billing.service.js';
import { type BillingContext, openBill, type RequestDetail } from '../platform-billing.service.js';
import type {
  PlatformBillingBillType,
  PlatformBillingLineType,
  PlatformBillingNextRenewalType,
  PlatformBillingOverviewType,
  PlatformBillingPreviewType,
  PlatformBillingRequestType,
  PlatformBillingStandingType,
} from './platform-billing.types.js';

/**
 * Rows to GraphQL shapes, in one place for both resolvers: the organization
 * and the platform read the same request the same way.
 */

/** Bill lines as GraphQL returns them: a missing day count is null. */
function lines(rows: readonly QuoteLine[]): PlatformBillingLineType[] {
  return rows.map((line) => ({
    kind: line.kind,
    amount: line.amount,
    days: line.days ?? null,
    months: line.months ?? null,
  }));
}

/** A bill: its stamp from the row, its words from the snapshot it was issued with. */
export function renderBill(row: BillRow): PlatformBillingBillType {
  const snapshot = readBillSnapshot(row.snapshot);
  return {
    id: row.id,
    number: documentNumber('bill', row.number),
    status: row.status,
    total: row.total,
    currency: row.currency,
    issuedAt: row.issuedAt.toISOString(),
    planLabel: snapshot.planLabel,
    fromPlanLabel: snapshot.fromPlanLabel,
    lines: lines(snapshot.lines),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelledReason: row.cancelledReason,
    issuerName: snapshot.issuer?.name ?? '',
    issuerDetails: snapshot.issuer?.details ?? '',
    issuedOn: snapshot.issuedOn,
    periodStart: snapshot.pricedForPeriod?.start ?? null,
    periodEnd: snapshot.pricedForPeriod?.end ?? null,
  };
}

/** A request with its bill in force, every bill, receipt, payment version and step. */
export function renderRequest(detail: RequestDetail): PlatformBillingRequestType {
  const { request } = detail;
  const bill = openBill(detail.bills);
  return {
    id: request.id,
    organizationId: request.organizationId,
    kind: request.kind,
    state: request.state,
    planKey: request.planKey,
    fromPlanKey: request.fromPlanKey,
    requestedById: request.requestedById,
    requestedAt: request.requestedAt.toISOString(),
    months: request.months,
    automatic: request.automatic,
    detailsVersion: request.detailsVersion,
    coveredOn: request.coveredOn ? dateColumnToDay(request.coveredOn) : null,
    holdDays: request.holdDays,
    holdReason: request.holdReason,
    decidedById: request.decidedById,
    decidedAt: request.decidedAt?.toISOString() ?? null,
    decisionReason: request.decisionReason,
    selfApproved: request.selfApproved,
    approverIsMember: request.approverIsMember,
    periodStart: request.periodStart ? dateColumnToDay(request.periodStart) : null,
    periodEnd: request.periodEnd ? dateColumnToDay(request.periodEnd) : null,
    accessUntil: request.accessUntil?.toISOString() ?? null,
    voidedById: request.voidedById,
    voidedAt: request.voidedAt?.toISOString() ?? null,
    voidReason: request.voidReason,
    bill: bill ? renderBill(bill) : null,
    bills: detail.bills.map(renderBill),
    receipts: detail.receipts.map((row) => {
      const printed = readReceiptPrint(row.snapshot);
      return {
        id: row.id,
        number: documentNumber('receipt', row.number),
        amount: row.amount,
        currency: row.currency,
        method: row.method,
        kind: row.kind,
        reference: printed.reference,
        issuedAt: row.issuedAt.toISOString(),
        voidedAt: row.voidedAt?.toISOString() ?? null,
        voidReason: row.voidReason,
        title: printed.title,
        notice: printed.notice,
        billNumber: printed.billNumber,
        planLabel: printed.planLabel,
        paidOn: printed.paidOn,
        periodStart: printed.periodStart,
        periodEnd: printed.periodEnd,
        issuerName: printed.issuerName,
        issuerDetails: printed.issuerDetails,
        issuedOn: printed.issuedOn,
      };
    }),
    payments: detail.payments.map((row) => ({
      version: row.version,
      method: row.method,
      amount: row.amount,
      paidOn: dateColumnToDay(row.paidOn),
      reference: row.reference,
      sender: row.sender,
      note: row.note,
      enteredById: row.enteredById,
      enteredAt: row.enteredAt.toISOString(),
    })),
    events: detail.events.map((row) => ({
      id: row.id,
      at: row.at.toISOString(),
      step: row.step,
      reason: row.reason,
      actorId: row.actorId,
      data: JSON.stringify(row.data ?? {}),
    })),
  };
}

/** A preview: the price, or the refusal with its sentence and next step (plan §6). */
export function renderPreview(
  kind: string,
  planKey: string | null,
  preview: RequestPreview,
): PlatformBillingPreviewType {
  const text = preview.refused ? refusalText(preview.refused) : null;
  const priced = preview.priced;
  return {
    kind,
    planKey,
    allowed: preview.refused === null,
    refusal: preview.refused,
    message: text?.message ?? null,
    nextStep: text?.nextStep ?? null,
    quote: priced
      ? {
          lines: lines(priced.quote.lines),
          total: priced.quote.total,
          creditUsed: priced.quote.creditUsed,
          creditAdded: priced.quote.creditAdded,
          direction: priced.direction,
          billAtSubmission: priced.billAtSubmission,
          periodStart: priced.period?.start ?? null,
          periodEnd: priced.period?.end ?? null,
        }
      : null,
    overruns: preview.overruns.map((overrun) => ({ ...overrun })),
  };
}

/** Where the organization stands, with the parts of its access end (plan §6). */
export function renderStanding(context: BillingContext): PlatformBillingStandingType {
  const { standing, live, liveDays, settings } = context;
  const plan = live ? context.plans.get(live.planKey) : undefined;
  const kind = standing.standing?.kind ?? 'none';
  const state = standing.standing;
  let days: number | null = null;
  if (state) {
    switch (state.kind) {
      case 'active':
      case 'renewal_open':
        days = state.daysToDue;
        break;
      case 'overdue':
      case 'held':
        days = state.daysLeft;
        break;
      case 'expired':
        days = state.daysAgo;
        break;
    }
  }
  return {
    kind,
    days,
    planKey: live?.planKey ?? null,
    planLabel: plan?.label ?? live?.planKey ?? null,
    planArchived: live?.planArchived ?? false,
    cancelled: context.cancelled,
    trial: live?.trial ?? false,
    periodStart: standing.currentPeriod?.start ?? null,
    periodEnd: standing.rowPeriod?.end ?? liveDays?.periodEnd ?? null,
    accessUntil: standing.window?.accessUntil ?? liveDays?.accessUntil ?? null,
    graceDays: standing.window?.graceDays ?? settings.graceDays,
    holdDays: standing.window?.holdDays ?? 0,
    prepaid: standing.prepaid,
  };
}

/** The Billing page's overview: standing, credit, the pending request, plans on offer, where to pay. */
export function renderOverview(
  context: BillingContext,
  pending: RequestDetail | null,
  organizationName: string | null = null,
): PlatformBillingOverviewType {
  const current = context.live?.planKey ?? null;
  const offered = [...context.plans.values()].filter(
    (plan) => plan.key === current || (plan.isPublic && !plan.archived),
  );
  return {
    organizationId: context.organizationId,
    today: context.today,
    timeZone: context.settings.timeZone,
    organizationName,
    currency: context.settings.currency,
    standing: renderStanding(context),
    creditBalance: context.creditBalance,
    pending: pending ? renderRequest(pending) : null,
    plans: offered.map((plan) => ({
      key: plan.key,
      label: plan.label,
      monthly: priceOn(context.prices, plan.key, context.today),
      isPublic: plan.isPublic,
      archived: plan.archived,
      current: plan.key === current,
    })),
    paymentAccounts: context.settings.paymentAccounts.map((account) => ({ ...account })),
    autoRenew: { enabled: context.autoRenew.enabled, setAt: context.autoRenew.setAt?.toISOString() ?? null },
    nextRenewal: renderNextRenewal(context),
  };
}

/**
 * The next renewal against the credit balance (#129): what it costs, what is
 * left to pay, and how far the credit pays ahead. Null with nothing to renew.
 */
function renderNextRenewal(context: BillingContext): PlatformBillingNextRenewalType | null {
  const period = context.standing.rowPeriod;
  if (!context.standing.hasPaidSubscription || !period || !context.live) return null;
  const monthly = priceOn(context.prices, context.live.planKey, context.today);
  if (monthly === null) return null;
  const ahead = paidUpTo(period, monthly, context.creditBalance);
  // Priced as the renewal request is (access used, a debt, the credit), so the page never promises a different total.
  const priced = priceRequest({
    kind: 'renew',
    planKey: context.live.planKey,
    currentPlanKey: context.live.planKey,
    standing: context.standing,
    prices: context.prices,
    creditBalance: context.creditBalance,
    day: context.today,
  });
  return {
    due: period.end,
    monthly,
    toPay: isRefused(priced) ? monthly : priced.quote.total,
    monthsPaid: ahead?.months ?? 0,
    paidUpTo: ahead?.until ?? null,
  };
}

/**
 * What a receipt printed, read leniently from its snapshot (`ReceiptSnapshot`):
 * a field a hand-edited or older row lacks reads as empty, never as today's
 * settings, so a reprint never says something the receipt did not.
 */
function readReceiptPrint(snapshot: unknown): {
  reference: string | null;
  title: string;
  notice: string;
  billNumber: string | null;
  planLabel: string;
  paidOn: string;
  periodStart: string | null;
  periodEnd: string | null;
  issuerName: string;
  issuerDetails: string;
  issuedOn: string;
} {
  const row = (typeof snapshot === 'object' && snapshot !== null ? snapshot : {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  const period = (typeof row.period === 'object' && row.period !== null ? row.period : {}) as Record<string, unknown>;
  const issuer = (typeof row.issuer === 'object' && row.issuer !== null ? row.issuer : {}) as Record<string, unknown>;
  return {
    reference: text(row.reference),
    title: text(row.title) ?? 'Acknowledgement receipt',
    notice: text(row.notice) ?? 'This is not an official receipt.',
    billNumber: text(row.billNumber),
    planLabel: text(row.planLabel) ?? '',
    paidOn: text(row.paidOn) ?? '',
    periodStart: text(period.start),
    periodEnd: text(period.end),
    issuerName: text(issuer.name) ?? '',
    issuerDetails: text(issuer.details) ?? '',
    issuedOn: text(row.issuedOn) ?? '',
  };
}
