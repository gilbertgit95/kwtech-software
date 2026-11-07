import { readBillSnapshot } from '../../domain/documents.js';
import type { QuoteLine } from '../../domain/quotes.js';
import { refusalText } from '../../domain/refusals.js';
import { documentNumber, priceOn } from '../../domain/standing.js';
import { type BillRow, dateColumnToDay } from '../platform-billing.repository.js';
import type { RequestPreview } from '../platform-billing.service.js';
import { type BillingContext, openBill, type RequestDetail } from '../platform-billing.service.js';
import type {
  PlatformBillingBillType,
  PlatformBillingLineType,
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
  return rows.map((line) => ({ kind: line.kind, amount: line.amount, days: line.days ?? null }));
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
    bill: bill ? renderBill(bill) : null,
    bills: detail.bills.map(renderBill),
    receipts: detail.receipts.map((row) => ({
      id: row.id,
      number: documentNumber('receipt', row.number),
      amount: row.amount,
      currency: row.currency,
      method: row.method,
      kind: row.kind,
      reference: readReference(row.snapshot),
      issuedAt: row.issuedAt.toISOString(),
      voidedAt: row.voidedAt?.toISOString() ?? null,
      voidReason: row.voidReason,
    })),
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
    periodStart: standing.currentPeriod?.start ?? null,
    periodEnd: standing.rowPeriod?.end ?? liveDays?.periodEnd ?? null,
    accessUntil: standing.window?.accessUntil ?? liveDays?.accessUntil ?? null,
    graceDays: standing.window?.graceDays ?? settings.graceDays,
    holdDays: standing.window?.holdDays ?? 0,
    prepaid: standing.prepaid,
  };
}

/** The Billing page's overview: standing, credit, the pending request, plans on offer, where to pay. */
export function renderOverview(context: BillingContext, pending: RequestDetail | null): PlatformBillingOverviewType {
  const current = context.live?.planKey ?? null;
  const offered = [...context.plans.values()].filter(
    (plan) => plan.key === current || (plan.isPublic && !plan.archived),
  );
  return {
    organizationId: context.organizationId,
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
  };
}

/** The payment reference a receipt printed, if any. */
function readReference(snapshot: unknown): string | null {
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const reference = (snapshot as { reference?: unknown }).reference;
  return typeof reference === 'string' ? reference : null;
}
