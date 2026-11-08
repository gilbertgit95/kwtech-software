import { isValidTimeZone } from '@kwtech/module-kit';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { accessWindow, isOnTime, planHold, planRenewal } from '../domain/access.js';
import { archiveCreditNote, archiveReversalNote, planArchiveCredit } from '../domain/archives.js';
import { addDays, type DayKey, isDayKey, platformDay, platformDayStart } from '../domain/days.js';
import { type BillSnapshot, billSnapshot, type ReceiptSnapshot, readBillSnapshot } from '../domain/documents.js';
import type { Centavos } from '../domain/money.js';
import { isPaymentMethod, needsReference, normaliseReference, type PaymentMethod } from '../domain/payments.js';
import { type Period, periodFrom } from '../domain/periods.js';
import { chargesAccessUsed, isRefused, type PricedRequest, priceRequest } from '../domain/pricing.js';
import { approvalLagCredit } from '../domain/quotes.js';
import { checkApproval, checkNewRequest, checkVoid, nextState, type PricedKind } from '../domain/requests.js';
import { billingStanding, documentNumber, hasAnyPrice, requestStanding } from '../domain/standing.js';
import {
  type AppliedHow,
  planVoid,
  readAppliedHow,
  readSubscriptionBefore,
  type SubscriptionBefore,
  type VoidPlan,
} from '../domain/voids.js';
import { billingRefusal } from './platform-billing.errors.js';
import {
  type BillRow,
  dateColumnToDay,
  dayToDateColumn,
  type JsonInput,
  type JsonValue,
  type PlatformBillingTransaction,
  type PlatformBillingWriteClient,
  type RequestRow,
} from './platform-billing.repository.js';
import {
  type BillingContext,
  PLATFORM_BILLING_SETTINGS_ID,
  PlatformBillingService,
  subscriptionDays,
} from './platform-billing.service.js';
import {
  PLATFORM_BILLING_NOTIFIER,
  PLATFORM_BILLING_PEOPLE,
  PLATFORM_BILLING_PRISMA_WRITE,
  PLATFORM_BILLING_SUBSCRIPTIONS,
} from './platform-billing.tokens.js';
import type {
  BillingAdjustment,
  BillingRequestStep,
  BillingSubscriptionRow,
  PlatformBillingNotifier,
  PlatformBillingPeople,
  PlatformBillingSubscriptions,
} from './ports.js';

/** The kinds `submit` takes. A cancel is `cancel`: it is priced at nothing and needs no approval. */
export type SubmittableKind = PricedKind;

/** What an owner (or admin) says they paid. */
export interface PaymentDetailsInput {
  method: string;
  /** Centavos. */
  amount: number;
  paidOn: string;
  reference?: string | null | undefined;
  sender?: string | null | undefined;
  note?: string | null | undefined;
}

/** What an approver confirms: the details version they reviewed, and the payment as received. */
export interface ApprovalInput {
  detailsVersion: number;
  method: string;
  amount: number;
  paidOn: string;
  reference?: string | null | undefined;
}

/** A settings change. An absent field is left as it is. */
export interface SettingsInput {
  currency?: string | null | undefined;
  timeZone?: string | null | undefined;
  graceDays?: number | null | undefined;
  issuerName?: string | null | undefined;
  issuerDetails?: string | null | undefined;
  paymentAccounts?: ReadonlyArray<{ method: string; label: string; details: string }> | null | undefined;
}

/**
 * The most pending requests one archive closes. A plan is archived by hand,
 * rarely, and an organization has at most one pending request; past this the
 * archive would be one transaction holding thousands of rows, and is better
 * split by stopping sales first (`isPublic`).
 */
const ARCHIVE_SWEEP_MAX = 5000;

/** The longest free text a person types into billing (a note, a reason, a reference). */
export const PLATFORM_BILLING_TEXT_MAX = 500;

/** The most grace a super admin may set: a month. More is not grace, it is a free plan. */
export const PLATFORM_BILLING_GRACE_MAX = 31;

/**
 * Every write billing makes.
 *
 * ## ⚠ ONE TRANSACTION PER ACT, SHARED WITH PERMISSIONS
 *
 * A submission writes the request, its bill and the bill's number together. An
 * approval writes the decision, the subscription (through the app's
 * `PLATFORM_BILLING_SUBSCRIPTIONS`, which hands this same transaction to
 * `module-permissions`), the receipt, its number and every credit entry
 * together. A failure anywhere leaves none of it, and the numbering no gap.
 *
 * ## ⚠ DECISIONS ARE COMPARE-AND-SET
 *
 * Every decision updates the request WHERE it is still `pending` (and, for an
 * approval, on the details version the approver saw) BEFORE anything else is
 * written. Of two approvals at once, the second waits on the row lock, finds
 * no pending row, and rolls back: one receipt, never two.
 */
@Injectable()
export class PlatformBillingWriteService {
  constructor(
    @Inject(PLATFORM_BILLING_PRISMA_WRITE) private readonly prisma: PlatformBillingWriteClient,
    private readonly reads: PlatformBillingService,
    @Inject(PLATFORM_BILLING_SUBSCRIPTIONS) private readonly subscriptions: PlatformBillingSubscriptions,
    @Optional() @Inject(PLATFORM_BILLING_PEOPLE) private readonly people?: PlatformBillingPeople,
    /** Unbound: nobody is told of a request's steps. */
    @Optional() @Inject(PLATFORM_BILLING_NOTIFIER) private readonly notifier?: PlatformBillingNotifier,
  ) {}

  private readonly logger = new Logger('PlatformBillingWrite');

  // ── the organization's side ───────────────────────────────────────────────

  /**
   * A new request: checked as the preview checks it, priced, and its bill
   * issued, except a downgrade's, which is issued at approval (D12).
   */
  async submit(
    organizationId: string,
    actorId: string,
    kind: SubmittableKind,
    planKey: string | null,
    now: Date,
  ): Promise<RequestRow> {
    const row = await this.prisma.$transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId);
      const context = await this.reads.context(organizationId, now, tx);
      const preview = await this.reads.preview(context, kind, planKey);
      if (preview.refused) {
        throw billingRefusal(preview.refused, preview.overruns.length > 0 ? { overruns: preview.overruns } : {});
      }
      const priced = preview.priced;
      if (!priced) throw billingRefusal('invalid');
      const wanted = kind === 'renew' ? (context.live?.planKey ?? '') : (planKey ?? '');

      let request: RequestRow;
      try {
        request = await tx.platformBillingRequest.create({
          data: {
            organizationId,
            kind,
            planKey: wanted,
            fromPlanKey: context.live?.planKey ?? null,
            // ⚠ The one-pending slot: a second pending request is a unique violation.
            pendingOrganizationId: organizationId,
            requestedById: actorId,
            requestedAt: now,
            pricedOn: dayToDateColumn(context.today),
            pricedForPeriodEnd: priced.period ? dayToDateColumn(priced.period.end) : null,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw billingRefusal('pending_request_exists');
        throw error;
      }
      await this.event(tx, request, now, actorId, 'submitted', null, {
        kind,
        planKey: wanted,
        total: priced.quote.total,
        direction: priced.direction,
      });
      if (priced.billAtSubmission) {
        await this.issueBill(tx, request, context, priced, now, actorId);
      } else {
        // Nothing is paid before a downgrade's approval, so nothing is billed: its credit is that day's (D12).
        await this.event(tx, request, now, actorId, 'bill_deferred', 'downgrade_billed_at_approval', {
          estimate: priced.quote.creditAdded,
        });
      }
      return request;
    });
    // After the commit: a notice never fails the write it reports.
    await this.tell(row, 'submitted', null);
    return row;
  }

  /**
   * A new version of the payment details. Every version is kept; the request's
   * `detailsVersion` moves, so an approver reviewing the old one is told.
   *
   * Two rules hang off it (plan §4, D9, D10):
   * - a renewal whose covering details arrive only after access ended is NOT
   *   on time: its bill is cancelled and a new one issued with the access used;
   * - a renewal's first covering details, entered before grace ends, hold
   *   access until an approver decides, once per period and never after a
   *   rejection.
   */
  async enterPayment(
    organizationId: string,
    requestId: string,
    actorId: string,
    input: PaymentDetailsInput,
    now: Date,
  ): Promise<RequestRow> {
    const details = preparePayment(input);
    const row = await this.prisma.$transaction(async (tx) => {
      const request = await this.lockedRequest(tx, { id: requestId, organizationId });
      const step = nextState(request.state, 'edit_details');
      if ('refused' in step) throw billingRefusal(step.refused);

      const context = await this.reads.context(organizationId, now, tx);
      const version = request.detailsVersion + 1;
      try {
        await tx.platformBillingPayment.create({
          data: {
            requestId,
            version,
            ...details,
            source: 'owner',
            enteredById: actorId,
            enteredAt: now,
          },
        });
      } catch (error) {
        // Two saves from the same version: one lands, the other reviews again.
        if (isUniqueViolation(error)) throw billingRefusal('details_changed');
        throw error;
      }
      const update: Parameters<PlatformBillingTransaction['platformBillingRequest']['updateMany']>[0]['data'] = {
        detailsVersion: version,
      };
      await this.event(tx, request, now, actorId, 'details_entered', null, {
        version,
        amount: details.amount,
        method: details.method,
      });

      let bill = await tx.platformBillingBill.findFirst({
        where: { requestId, status: { not: 'cancelled' } },
        orderBy: { number: 'desc' },
      });
      const window = context.standing.window;

      // ⚠ NOT ON TIME (plan §4, D10): access ended before covering details, so the bill must charge the access used.
      if (
        request.kind === 'renew' &&
        bill &&
        request.coveredOn === null &&
        window &&
        context.today >= window.accessUntil
      ) {
        const snapshot = readBillSnapshot(bill.snapshot);
        if (!chargesAccessUsed(snapshot)) {
          await this.cancelBill(tx, request, bill, 'access_ended_before_details', now, actorId);
          const priced = priceRequest({
            kind: 'renew',
            planKey: request.planKey,
            currentPlanKey: context.live?.planKey ?? null,
            standing: context.standing,
            prices: context.prices,
            creditBalance: context.creditBalance,
            day: context.today,
          });
          if (isRefused(priced)) throw billingRefusal(priced.refused);
          bill = await this.issueBill(tx, request, context, priced, now, actorId);
        }
      }

      const covers = bill !== null && details.amount >= bill.total;
      if (bill && covers && bill.status === 'unpaid') {
        await tx.platformBillingBill.update({ where: { id: bill.id }, data: { status: 'submitted' } });
      }
      if (bill && !covers && bill.status === 'submitted') {
        // A correction downwards: the bill is no longer covered.
        await tx.platformBillingBill.update({ where: { id: bill.id }, data: { status: 'unpaid' } });
      }
      if (covers && request.coveredOn === null) {
        update.coveredOn = dayToDateColumn(context.today);
        if (request.kind === 'renew' && window && context.today < window.accessUntil) {
          const hold = await this.holdFor(tx, request, context);
          update.holdReason = hold.kind === 'held' ? 'held' : hold.reason;
          if (hold.kind === 'held') {
            const held = addDays(addDays(window.periodEnd, context.settings.graceDays), hold.days);
            if (held > window.accessUntil && context.live?.accessUntil) {
              // Kept so the hold is undone exactly, whatever the grace setting is by then.
              update.accessUntilBeforeHold = context.live.accessUntil;
              await this.subscriptions.setAccessUntil(
                { organizationId, accessUntil: platformDayStart(held, context.settings.timeZone) },
                tx,
              );
              update.holdDays = hold.days;
              await this.event(tx, request, now, actorId, 'hold_given', 'covering_details_before_grace_end', {
                days: hold.days,
                accessUntil: held,
              });
            }
          } else {
            await this.event(tx, request, now, actorId, 'hold_not_given', hold.reason, {});
          }
        }
      }

      const changed = await tx.platformBillingRequest.updateMany({
        where: { id: requestId, state: 'pending', detailsVersion: request.detailsVersion },
        data: update,
      });
      if (changed.count === 0) throw billingRefusal('details_changed');
      return this.reread(tx, requestId);
    });
    // After the commit: a notice never fails the write it reports.
    await this.tell(row, 'details_entered', null);
    return row;
  }

  /** The organization takes its request back. Nothing changes; its bill is cancelled and any hold given back. */
  async withdraw(
    organizationId: string,
    requestId: string,
    actorId: string,
    reason: string | null,
    now: Date,
  ): Promise<RequestRow> {
    return this.close(requestId, { organizationId }, actorId, 'withdraw', prepareText(reason), now);
  }

  // ── the platform's side ───────────────────────────────────────────────────

  /** An approver rejects, with the reason the organization reads. */
  async reject(requestId: string, actorId: string, reason: string, now: Date): Promise<RequestRow> {
    const text = prepareText(reason);
    if (!text) throw billingRefusal('invalid', { field: 'reason' });
    return this.close(requestId, {}, actorId, 'reject', text, now);
  }

  /**
   * "We were paid": the plan applied, the bill paid, a receipt issued, every
   * credit entry written — together, or not at all.
   */
  async approve(requestId: string, actorId: string, input: ApprovalInput, now: Date): Promise<RequestRow> {
    const received = preparePayment({ ...input, sender: null, note: null });
    const row = await this.prisma.$transaction(async (tx) => {
      const request = await this.lockedRequest(tx, { id: requestId });
      const context = await this.reads.context(request.organizationId, now, tx);
      const plan = context.plans.get(request.planKey);
      if (!plan) throw billingRefusal('not_found');

      // A downgrade is priced on the day it is approved, and billed then (D12).
      let bill = await tx.platformBillingBill.findFirst({
        where: { requestId, status: { not: 'cancelled' } },
        orderBy: { number: 'desc' },
      });
      let pricedNow: PricedRequest | null = null;
      if (request.kind === 'change_plan' && !bill) {
        const overruns = await this.reads.overruns(request.organizationId, plan);
        if (overruns.length > 0) throw billingRefusal('over_new_plan_caps', { overruns });
        const priced = priceRequest({
          kind: 'change_plan',
          planKey: request.planKey,
          currentPlanKey: context.live?.planKey ?? null,
          standing: context.standing,
          prices: context.prices,
          creditBalance: context.creditBalance,
          day: context.today,
        });
        if (isRefused(priced)) throw billingRefusal(priced.refused);
        pricedNow = priced;
      }
      const total = bill ? bill.total : (pricedNow?.quote.total ?? 0);
      const pricedFor = request.pricedForPeriodEnd ? dateColumnToDay(request.pricedForPeriodEnd) : undefined;
      const refused = checkApproval({
        state: request.state,
        detailsVersionSeen: input.detailsVersion,
        detailsVersion: request.detailsVersion,
        received: received.amount,
        total,
        ...(request.kind === 'change_plan' && pricedFor !== undefined
          ? { pricedForPeriodEnd: pricedFor, currentPeriodEnd: context.standing.currentPeriod?.end ?? '' }
          : {}),
        planArchived: plan.archived,
      });
      if (refused) {
        throw billingRefusal(refused, refused === 'payment_short' ? { short: total - received.amount } : {});
      }

      const applied = this.periodFor(request, context);
      const selfApproved = request.requestedById === actorId;
      const approverIsMember = this.people ? await this.people.isMember(actorId, request.organizationId) : true;

      // ⚠ THE COMPARE-AND-SET, before anything else is written: the loser of two approvals stops here.
      const decided = await tx.platformBillingRequest.updateMany({
        where: { id: requestId, state: 'pending', detailsVersion: input.detailsVersion },
        data: {
          state: 'approved',
          pendingOrganizationId: null,
          decidedById: actorId,
          decidedAt: now,
          selfApproved,
          approverIsMember,
          periodStart: dayToDateColumn(applied.period.start),
          periodEnd: dayToDateColumn(applied.period.end),
          billingDay: applied.period.billingDay,
          accessUntil: platformDayStart(applied.accessUntil, context.settings.timeZone),
          // What a void reverses, kept as it was today (D9a).
          applied: applied.how satisfies AppliedHow,
          ...asJson(beforeOf(context, request)),
        },
      });
      if (decided.count === 0) {
        const again = await tx.platformBillingRequest.findFirst({ where: { id: requestId } });
        throw billingRefusal(again && again.state === 'pending' ? 'details_changed' : 'not_pending');
      }

      if (pricedNow) bill = await this.issueBill(tx, request, context, pricedNow, now, actorId);
      if (!bill) throw billingRefusal('not_found');
      const snapshot = readBillSnapshot(bill.snapshot);

      const write = {
        organizationId: request.organizationId,
        periodStart: platformDayStart(applied.period.start, context.settings.timeZone),
        periodEnd: platformDayStart(applied.period.end, context.settings.timeZone),
        billingDay: applied.period.billingDay,
        accessUntil: platformDayStart(applied.accessUntil, context.settings.timeZone),
      };
      const { subscriptionId } =
        applied.how === 'renew'
          ? await this.subscriptions.renew(write, tx)
          : applied.how === 'change'
            ? await this.subscriptions.changePlan({ ...write, planKey: request.planKey }, tx)
            : await this.subscriptions.start({ ...write, planKey: request.planKey }, tx);

      await tx.platformBillingBill.update({ where: { id: bill.id }, data: { status: 'paid' } });
      const receiptNumber = await this.nextNumber(tx, 'receipt');
      const receiptSnapshot: ReceiptSnapshot = {
        number: documentNumber('receipt', receiptNumber),
        title: 'Acknowledgement receipt',
        notice: 'This is not an official receipt.',
        billNumber: documentNumber('bill', bill.number),
        kind: 'payment',
        organizationId: request.organizationId,
        planLabel: plan.label,
        amount: received.amount,
        currency: context.settings.currency,
        method: received.method,
        reference: received.reference,
        paidOn: dateColumnToDay(received.paidOn),
        period: { start: applied.period.start, end: applied.period.end },
        selfApproved,
        issuer: context.settings.issuer,
        issuedOn: context.today,
      };
      const receipt = await tx.platformBillingReceipt.create({
        data: {
          requestId,
          billId: bill.id,
          organizationId: request.organizationId,
          number: receiptNumber,
          amount: received.amount,
          currency: context.settings.currency,
          method: received.method,
          kind: 'payment',
          snapshot: receiptSnapshot,
          issuedAt: now,
          issuedById: actorId,
        },
      });

      // Every ledger entry the approval makes, each pointing at its bill (plan §4).
      const entries: Array<{ amount: Centavos; kind: string }> = [
        { amount: -snapshot.creditUsed, kind: 'credit_used' },
        { amount: snapshot.owedCleared, kind: 'owed_cleared' },
        { amount: snapshot.creditAdded, kind: 'change_credit' },
        // D7: an overpayment is credit, never change handed back.
        { amount: received.amount - total, kind: 'overpayment' },
        { amount: this.lagCredit(request, snapshot, context.today), kind: 'approval_lag' },
      ];
      for (const entry of entries) {
        // Sequential: one transaction, and the ledger reads in the order it was written.
        if (entry.amount === 0) continue;
        await tx.platformBillingCredit.create({
          data: {
            organizationId: request.organizationId,
            amount: entry.amount,
            kind: entry.kind,
            requestId,
            billId: bill.id,
            receiptId: receipt.id,
            note: null,
            createdById: actorId,
            createdAt: now,
          },
        });
        await this.event(tx, request, now, actorId, 'credit', entry.kind, { amount: entry.amount });
      }

      await tx.platformBillingRequest.update({ where: { id: requestId }, data: { subscriptionId } });
      await this.event(tx, request, now, actorId, 'approved', selfApproved ? 'self_approved' : null, {
        received: received.amount,
        total,
        how: applied.how,
        periodStart: applied.period.start,
        periodEnd: applied.period.end,
        accessUntil: applied.accessUntil,
        approverIsMember,
      });
      await this.event(tx, request, now, actorId, 'receipt_issued', null, {
        number: receiptNumber,
        amount: received.amount,
      });
      return this.reread(tx, requestId);
    });
    // After the commit: a notice never fails the write it reports.
    await this.tell(row, 'approved', null);
    return row;
  }

  /**
   * "We were paid, but this can no longer be applied" (D12a): a plan change
   * whose quote expired, or any pending request an approver decides to keep
   * as credit. The payment actually received is recorded WHATEVER its amount
   * (D7 governs approval, not this), a receipt issued for exactly that
   * ("Payment received, held as credit"), the credit added once, and the plan
   * left as it is.
   *
   * ⚠ The bill is CANCELLED, never paid: a bill of 500 must not read PAID on
   * 200. Its cancellation names the receipt, so the history reads "closed as
   * credit: 200 received, receipt R-000009". The request is no longer
   * pending, so the owner can request again and the credit pays for it.
   */
  async closeAsCredit(
    requestId: string,
    actorId: string,
    input: ApprovalInput,
    reason: string | null,
    now: Date,
  ): Promise<RequestRow> {
    const received = preparePayment({ ...input, sender: null, note: null });
    if (received.amount <= 0) throw billingRefusal('nothing_received');
    const text = prepareText(reason);
    const row = await this.prisma.$transaction(async (tx) => {
      const request = await this.lockedRequest(tx, { id: requestId });
      const step = nextState(request.state, 'close_as_credit');
      if ('refused' in step) throw billingRefusal(step.refused);
      if (input.detailsVersion !== request.detailsVersion) throw billingRefusal('details_changed');
      const context = await this.reads.context(request.organizationId, now, tx);
      const selfApproved = request.requestedById === actorId;
      const approverIsMember = this.people ? await this.people.isMember(actorId, request.organizationId) : true;

      // ⚠ THE COMPARE-AND-SET, as an approval's: of an approval and a close at once, one stands.
      const decided = await tx.platformBillingRequest.updateMany({
        where: { id: requestId, state: 'pending', detailsVersion: input.detailsVersion },
        data: {
          state: step.state,
          pendingOrganizationId: null,
          decidedById: actorId,
          decidedAt: now,
          decisionReason: text,
          selfApproved,
          approverIsMember,
        },
      });
      if (decided.count === 0) {
        const again = await tx.platformBillingRequest.findFirst({ where: { id: requestId } });
        throw billingRefusal(again && again.state === 'pending' ? 'details_changed' : 'not_pending');
      }

      const bill = await tx.platformBillingBill.findFirst({
        where: { requestId, status: { not: 'cancelled' } },
        orderBy: { number: 'desc' },
      });
      const plan = context.plans.get(request.planKey);
      const receiptNumber = await this.nextNumber(tx, 'receipt');
      const receiptSnapshot: ReceiptSnapshot = {
        number: documentNumber('receipt', receiptNumber),
        title: 'Acknowledgement receipt',
        notice: 'This is not an official receipt.',
        billNumber: bill ? documentNumber('bill', bill.number) : null,
        kind: 'closed_as_credit',
        organizationId: request.organizationId,
        planLabel: plan?.label ?? request.planKey,
        amount: received.amount,
        currency: context.settings.currency,
        method: received.method,
        reference: received.reference,
        paidOn: dateColumnToDay(received.paidOn),
        // It bought no period: the plan did not change.
        period: null,
        selfApproved,
        issuer: context.settings.issuer,
        issuedOn: context.today,
      };
      const receipt = await tx.platformBillingReceipt.create({
        data: {
          requestId,
          billId: bill?.id ?? null,
          organizationId: request.organizationId,
          number: receiptNumber,
          amount: received.amount,
          currency: context.settings.currency,
          method: received.method,
          kind: 'closed_as_credit',
          snapshot: receiptSnapshot,
          issuedAt: now,
          issuedById: actorId,
        },
      });
      if (bill) {
        await this.cancelBill(tx, request, bill, 'closed_as_credit', now, actorId, {
          received: received.amount,
          receiptNumber,
        });
      }
      // Added ONCE, here, for the whole amount received: nothing was spent from the balance, since nothing applied.
      await tx.platformBillingCredit.create({
        data: {
          organizationId: request.organizationId,
          amount: received.amount,
          kind: 'closed_as_credit',
          requestId,
          billId: bill?.id ?? null,
          receiptId: receipt.id,
          note: null,
          createdById: actorId,
          createdAt: now,
        },
      });
      await this.releaseHold(tx, request, now, actorId, 'closed_as_credit');
      await this.event(tx, request, now, actorId, 'closed_as_credit', selfApproved ? 'self_approved' : null, {
        received: received.amount,
        reason: text,
        approverIsMember,
      });
      await this.event(tx, request, now, actorId, 'receipt_issued', 'closed_as_credit', {
        number: receiptNumber,
        amount: received.amount,
      });
      await this.event(tx, request, now, actorId, 'credit', 'closed_as_credit', { amount: received.amount });
      return this.reread(tx, requestId);
    });
    // After the commit: a notice never fails the write it reports.
    await this.tell(row, 'closed_as_credit', text);
    return row;
  }

  /**
   * A mistaken approval reversed, with a reason (plan §4, D9a). Nothing is
   * deleted: the receipt keeps its number and is stamped VOID, the bill goes
   * back to unpaid, every credit entry the receipt made is reversed (the
   * balance may go negative: owed on the next bill), and the subscription is
   * put back to what the approval replaced (`planVoid`).
   *
   * ⚠ NEWEST FIRST. Only the organization's latest approval can be voided:
   * with A → B → C, voiding A → B would put A back over the paid C. And the
   * live subscription must still be the row this approval wrote; one changed
   * since (an admin's edit, a later approval) is refused, never overwritten.
   */
  async void(requestId: string, actorId: string, reason: string, now: Date): Promise<RequestRow> {
    const text = prepareText(reason);
    if (!text) throw billingRefusal('invalid', { field: 'reason' });
    const row = await this.prisma.$transaction(async (tx) => {
      const request = await this.lockedRequest(tx, { id: requestId });
      if (request.kind === 'adjustment') throw billingRefusal('adjustment_not_voidable');
      const step = nextState(request.state, 'void');
      if ('refused' in step) throw billingRefusal(step.refused);

      // Adjustments are not approvals of a payment: never "the later one to void first". An adjustment
      // since this approval changed the row, so the check below refuses as `subscription_changed`.
      const latest = await tx.platformBillingRequest.findFirst({
        where: { organizationId: request.organizationId, state: 'approved', kind: { not: 'adjustment' } },
        orderBy: { decidedAt: 'desc' },
      });
      const approvals = [request, ...(latest && latest.id !== request.id ? [latest] : [])].map((one) => ({
        requestId: one.id,
        approvedAt: one.decidedAt?.toISOString() ?? '',
      }));
      const notLatest = checkVoid(request.id, approvals);
      if (notLatest) throw billingRefusal(notLatest, latest ? { latestRequestId: latest.id } : {});

      // ⚠ An adjustment since this approval changed what it wrote, even one that left the dates as they were:
      // the void would undo the admin's act as well. Checked apart from the state comparison below.
      const adjustedSince =
        request.decidedAt === null
          ? null
          : await tx.platformBillingRequest.findFirst({
              where: {
                organizationId: request.organizationId,
                state: 'approved',
                kind: 'adjustment',
                decidedAt: { gt: request.decidedAt },
              },
            });
      if (adjustedSince) throw billingRefusal('subscription_changed', { adjustmentId: adjustedSince.id });

      const context = await this.reads.context(request.organizationId, now, tx);
      // ⚠ The live row must still be the one this approval left: the same row (or the one a newer
      // void restored in its place) in the same state. An admin's edit since is never overwritten.
      const ownRow = context.live ? await this.isApprovalsRow(tx, request, context.live.subscriptionId) : false;
      if (!context.live || !ownRow || !leftAsApproved(context.live, request, context.settings.timeZone)) {
        throw billingRefusal('subscription_changed');
      }
      const before = readSubscriptionBefore(request.subscriptionBefore);
      const previous = before ? context.plans.get(before.planKey) : undefined;
      const plan = planVoid(readAppliedHow(request.applied), before, previous !== undefined && !previous.archived);
      if ('refused' in plan) throw billingRefusal(plan.refused);

      const voided = await tx.platformBillingRequest.updateMany({
        where: { id: requestId, state: 'approved' },
        data: { state: step.state, voidedById: actorId, voidedAt: now, voidReason: text },
      });
      if (voided.count === 0) throw billingRefusal('not_approved');

      const restored = await this.reverseSubscription(tx, request.organizationId, plan, context.settings.timeZone);
      if (plan.kind === 'restore_plan') {
        await tx.platformBillingRequest.update({
          where: { id: requestId },
          data: { restoredSubscriptionId: restored },
        });
      }

      const receipt = await tx.platformBillingReceipt.findFirst({
        where: { requestId, kind: 'payment', voidedAt: null },
        orderBy: { number: 'desc' },
      });
      if (receipt) {
        await tx.platformBillingReceipt.update({
          where: { id: receipt.id },
          data: { voidedAt: now, voidedById: actorId, voidReason: text },
        });
        await this.event(tx, request, now, actorId, 'receipt_voided', null, { number: receipt.number });
        // Sequential: one transaction, and the ledger reads in the order it was written.
        const entries = await tx.platformBillingCredit.findMany({
          where: { receiptId: receipt.id },
          orderBy: { createdAt: 'asc' },
        });
        for (const entry of entries) {
          await tx.platformBillingCredit.create({
            data: {
              organizationId: request.organizationId,
              amount: -entry.amount,
              kind: 'void_reversal',
              requestId,
              billId: entry.billId,
              receiptId: receipt.id,
              // The entry it reverses, so the statement reads "reversed: overpayment".
              note: entry.kind,
              createdById: actorId,
              createdAt: now,
            },
          });
          await this.event(tx, request, now, actorId, 'credit', 'void_reversal', {
            amount: -entry.amount,
            reverses: entry.kind,
          });
        }
      }
      const bill = await tx.platformBillingBill.findFirst({
        where: { requestId, status: { not: 'cancelled' } },
        orderBy: { number: 'desc' },
      });
      if (bill && bill.status === 'paid') {
        await tx.platformBillingBill.update({ where: { id: bill.id }, data: { status: 'unpaid' } });
        await this.event(tx, request, now, actorId, 'bill_unpaid', 'voided', { number: bill.number });
      }
      await this.event(tx, request, now, actorId, 'voided', null, { reason: text, subscription: plan.kind });
      return this.reread(tx, requestId);
    });
    // After the commit: a notice never fails the write it reports.
    await this.tell(row, 'voided', text);
    return row;
  }

  /**
   * The owner ends the plan at the close of its period, with no credit (plan
   * §4). Nothing is paid and nobody needs to check anything, so it applies
   * at once, recorded as a request decided by the owner
   * (`cancel_needs_no_approval`): access ends on the period's last day,
   * without grace. Renewing undoes it, and a plan change starts a new row
   * that the cancel no longer covers.
   *
   * ⚠ It still takes the one-pending slot for the instant it is written, so a
   * cancel and a renewal pressed together cannot both land.
   */
  async cancel(organizationId: string, actorId: string, now: Date): Promise<RequestRow> {
    const row = await this.prisma.$transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId);
      const context = await this.reads.context(organizationId, now, tx);
      const refused = checkNewRequest({
        kind: 'cancel',
        // The guard proved it: cancel is bound to `platform-billing:change_plan`, the owner's (D8).
        actorIsOwner: true,
        standing: requestStanding(
          context.standing,
          context.liveDays,
          context.today,
          context.pending !== null,
          context.cancelled,
        ),
        currentPlanKey: context.live?.planKey ?? null,
        plan: null,
        overCaps: 0,
      });
      if (refused) throw billingRefusal(refused);
      const live = context.live;
      const period = context.standing.rowPeriod;
      if (!live || !period) throw billingRefusal('no_subscription');

      let request: RequestRow;
      try {
        request = await tx.platformBillingRequest.create({
          data: {
            organizationId,
            kind: 'cancel',
            planKey: live.planKey,
            fromPlanKey: live.planKey,
            pendingOrganizationId: organizationId,
            requestedById: actorId,
            requestedAt: now,
            pricedOn: dayToDateColumn(context.today),
            pricedForPeriodEnd: null,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw billingRefusal('pending_request_exists');
        throw error;
      }
      const accessUntil = platformDayStart(period.end, context.settings.timeZone);
      const before = beforeOf(context, null);
      await tx.platformBillingRequest.updateMany({
        where: { id: request.id, state: 'pending' },
        data: {
          state: 'approved',
          pendingOrganizationId: null,
          decidedById: actorId,
          decidedAt: now,
          decisionReason: 'cancel_needs_no_approval',
          periodStart: dayToDateColumn(period.start),
          periodEnd: dayToDateColumn(period.end),
          billingDay: period.billingDay,
          accessUntil,
          applied: 'cancel' satisfies AppliedHow,
          ...asJson(before),
        },
      });
      const { subscriptionId } = await this.subscriptions.setAccessUntil({ organizationId, accessUntil }, tx);
      await tx.platformBillingRequest.update({ where: { id: request.id }, data: { subscriptionId } });
      await this.event(tx, request, now, actorId, 'submitted', null, { kind: 'cancel', planKey: live.planKey });
      await this.event(tx, request, now, actorId, 'approved', 'cancel_needs_no_approval', {
        accessUntil: period.end,
        accessUntilBefore: before?.accessUntil ?? null,
      });
      return this.reread(tx, request.id);
    });
    // After the commit: a notice never fails the write it reports.
    await this.tell(row, 'cancelled', null);
    return row;
  }

  /**
   * A plan was archived, or brought back (D12b). Told by `module-permissions`
   * INSIDE the archive's own transaction (`tx`, through the app's hook), so
   * the archive and everything billing does about it commit together, and a
   * refusal here leaves the plan as it was.
   *
   * Archiving, in this order (plan §4):
   * 1. **Every pending request naming the plan is closed first** (a renewal
   *    of it, any request for it, a change away from it), so none blocks the
   *    replacement and no quote applies the plan's unused value again after
   *    the archive credit has. One without payment is withdrawn by the system
   *    (`plan_archived`). ⚠ One WITH payment details refuses the archive
   *    (`archive_pending_payments`): only an approver confirms a payment was
   *    received, and closing it as credit unseen would turn typed-in details
   *    into money. The plan said "closed as credit"; this is stricter.
   * 2. **Every organization on the plan is credited its paid days lost**,
   *    from the archive day to its period end, and a month paid ahead, once
   *    per subscription row (`planArchiveCredit`), with the sentence on the
   *    ledger.
   *
   * Bringing a plan back gives its access back, so the credit is taken back
   * from every row still on the plan. An organization that already moved to
   * another plan keeps its credit: it lost the days.
   */
  async planArchiveChanged(
    planKey: string,
    archived: boolean,
    now: Date,
    tx: PlatformBillingTransaction,
  ): Promise<void> {
    const settings = await this.reads.settings(tx);
    const today = platformDay(now, settings.timeZone);
    const label = (await this.reads.plans()).get(planKey)?.label ?? planKey;
    // ⚠ READ, LOCK, READ AGAIN. The first read only decides whom to lock;
    // every organization is locked in ONE sorted order, so two archives at
    // once queue instead of deadlocking. A decision that committed while this
    // waited (a renewal, a plan change, new payment details) is only visible
    // to a read made after the lock, so both lists are read again and the
    // second answer is the one used. An organization that appears only in the
    // second read is locked too, before anything of it is written.
    const locked = new Set<string>();
    const lockAll = async (ids: readonly string[]) => {
      for (const organizationId of [...new Set(ids)].sort()) {
        if (locked.has(organizationId)) continue;
        await this.lockOrganization(tx, organizationId);
        locked.add(organizationId);
      }
    };
    const readBoth = async () =>
      [
        archived ? await this.pendingNaming(tx, planKey) : [],
        await this.subscriptions.liveOnPlan(planKey, tx),
      ] as const;
    const [firstNamed, firstRows] = await readBoth();
    await lockAll([...firstNamed, ...firstRows].map((one) => one.organizationId));
    const [named, rows] = await readBoth();
    await lockAll([...named, ...rows].map((one) => one.organizationId));

    if (named.length > 0) {
      const paid: string[] = [];
      for (const request of named) {
        const latest = await tx.platformBillingPayment.findFirst({
          where: { requestId: request.id },
          orderBy: { version: 'desc' },
        });
        if (latest && latest.amount > 0) paid.push(request.id);
      }
      // Refused before anything is written: the whole archive rolls back with it.
      if (paid.length > 0) throw billingRefusal('archive_pending_payments', { requestIds: paid });
      for (const request of named) await this.withdrawForArchive(tx, request, now);
    }

    const prices = await this.reads.prices(tx);
    const priced = hasAnyPrice(prices, planKey);
    // Sequential: one transaction, and the ledger reads in the order it was written.
    for (const row of rows) {
      const entries = await tx.platformBillingCredit.findMany({
        where: { subscriptionId: row.subscriptionId, kind: { in: ['archive', 'archive_reversal'] } },
        orderBy: { createdAt: 'asc' },
      });
      const standingCredit = entries.reduce((sum, entry) => sum + entry.amount, 0);
      if (!archived) {
        if (standingCredit <= 0) continue;
        await this.archiveEntry(tx, row, -standingCredit, 'archive_reversal', archiveReversalNote(label, today), now);
        continue;
      }
      // Once per row: an archive repeated after a restore credits again only what the restore took back.
      if (standingCredit > 0) continue;
      const standing = billingStanding(subscriptionDays(row, settings.timeZone), today, settings.graceDays, priced);
      const credit = planArchiveCredit(standing, prices, planKey, today);
      if (!credit) continue;
      await this.archiveEntry(tx, row, credit.amount, 'archive', archiveCreditNote(label, today, credit), now);
    }
  }

  /**
   * Billing's decision lock for `organizationId`, taken in another module's
   * transaction (the admin screens' subscription writes, D5) BEFORE it reads
   * the subscription, so an approval, a void or a cancel for the same
   * organization never writes beside it.
   */
  async lockForAdjustment(organizationId: string, tx: PlatformBillingTransaction): Promise<void> {
    await this.lockOrganization(tx, organizationId);
  }

  /**
   * A subscription written by hand on the admin screens (D5), recorded in the
   * organization's history: an approved request of kind `adjustment`,
   * decided by the admin, with the reason as its decision and no bill, no
   * receipt and no credit ("adjusted by X, no payment"). Told by
   * `module-permissions` INSIDE the write's own transaction (`tx`, through
   * the app's audit adapter), so the row and its record commit together.
   *
   * ⚠ It does not take the pending slot: an adjustment never waits, and it
   * must not be refused because the organization has a request pending. The
   * pending request is then priced on a subscription that changed; approving
   * it re-reads the subscription, and a stale plan-change quote is refused
   * (`quote_expired`) as it is after any change.
   */
  async recordAdjustment(input: BillingAdjustment, tx: PlatformBillingTransaction): Promise<RequestRow> {
    await this.lockOrganization(tx, input.organizationId);
    const settings = await this.reads.settings(tx);
    const request = await tx.platformBillingRequest.create({
      data: {
        organizationId: input.organizationId,
        kind: 'adjustment',
        planKey: input.planKey,
        fromPlanKey: null,
        pendingOrganizationId: null,
        requestedById: input.actorId,
        requestedAt: input.at,
        pricedOn: dayToDateColumn(platformDay(input.at, settings.timeZone)),
        pricedForPeriodEnd: null,
      },
    });
    const { after, before } = input;
    await tx.platformBillingRequest.updateMany({
      where: { id: request.id, state: 'pending' },
      data: {
        state: 'approved',
        decidedById: input.actorId,
        decidedAt: input.at,
        decisionReason: input.reason,
        subscriptionId: input.subscriptionId,
        applied: 'adjustment',
        ...(after.currentPeriodEnd
          ? { periodEnd: dayToDateColumn(platformDay(after.currentPeriodEnd, settings.timeZone)) }
          : {}),
        ...(after.accessUntil ? { accessUntil: after.accessUntil } : {}),
      },
    });
    // Both sides of the change, so the history says what it was as well as what it became.
    const asData = (row: BillingAdjustment['after'] | null): JsonValue =>
      row
        ? {
            status: row.status,
            currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
            accessUntil: row.accessUntil?.toISOString() ?? null,
          }
        : null;
    await this.event(tx, request, input.at, input.actorId, 'adjusted', input.action, {
      reason: input.reason,
      planKey: input.planKey,
      payment: 'none',
      before: asData(before),
      after: asData(after),
    });
    return this.reread(tx, request.id);
  }

  /** The platform's settings. ⚠ Currency and time zone are locked once a bill exists (D16). */
  async setSettings(actorId: string, input: SettingsInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.reads.settings(tx);
      const billed = (await tx.platformBillingBill.count({ where: {} })) > 0;
      const data: Parameters<PlatformBillingTransaction['platformBillingSettings']['upsert']>[0]['update'] = {
        updatedById: actorId,
      };
      if (input.currency != null && input.currency !== current.currency) {
        if (!/^[A-Z]{3}$/u.test(input.currency)) throw billingRefusal('invalid', { field: 'currency' });
        if (billed) throw billingRefusal('currency_locked');
        data.currency = input.currency;
      }
      if (input.timeZone != null && input.timeZone !== current.timeZone) {
        if (!isValidTimeZone(input.timeZone)) throw billingRefusal('invalid', { field: 'timeZone' });
        if (billed) throw billingRefusal('time_zone_locked');
        data.timeZone = input.timeZone;
      }
      if (input.graceDays != null) {
        if (!Number.isInteger(input.graceDays) || input.graceDays < 0 || input.graceDays > PLATFORM_BILLING_GRACE_MAX) {
          throw billingRefusal('invalid', { field: 'graceDays', max: PLATFORM_BILLING_GRACE_MAX });
        }
        // A lower value reaches only periods written after it: no setting change expires anybody (D16).
        data.graceDays = input.graceDays;
      }
      if (input.issuerName != null) data.issuerName = prepareText(input.issuerName) ?? '';
      if (input.issuerDetails != null) data.issuerDetails = prepareText(input.issuerDetails, 2000) ?? '';
      if (input.paymentAccounts != null) {
        const accounts = input.paymentAccounts.map((account) => ({
          method: account.method,
          label: prepareText(account.label) ?? '',
          details: prepareText(account.details) ?? '',
        }));
        if (accounts.some((account) => !isPaymentMethod(account.method) || !account.label)) {
          throw billingRefusal('invalid', { field: 'paymentAccounts' });
        }
        data.paymentAccounts = accounts;
      }
      await tx.platformBillingSettings.upsert({
        where: { id: PLATFORM_BILLING_SETTINGS_ID },
        create: { id: PLATFORM_BILLING_SETTINGS_ID, ...data },
        update: data,
      });
    });
  }

  /**
   * A plan's monthly price from a day on. A price takes effect from a day,
   * never retroactively on bills issued: each bill priced itself when issued.
   */
  async setPrice(actorId: string, planKey: string, monthly: number, effectiveFrom: string): Promise<void> {
    if (!Number.isSafeInteger(monthly) || monthly < 0) throw billingRefusal('invalid', { field: 'monthly' });
    if (!isDayKey(effectiveFrom)) throw billingRefusal('invalid', { field: 'effectiveFrom' });
    const plans = await this.reads.plans();
    if (!plans.has(planKey)) throw billingRefusal('not_found');
    await this.prisma.platformBillingPrice.upsert({
      where: { planKey_effectiveFrom: { planKey, effectiveFrom: dayToDateColumn(effectiveFrom) } },
      create: { planKey, monthly, effectiveFrom: dayToDateColumn(effectiveFrom), setById: actorId },
      update: { monthly, setById: actorId },
    });
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /** Withdraw or reject: a compare-and-set, the bill cancelled, any hold taken back. */
  private async close(
    requestId: string,
    scope: { organizationId?: string },
    actorId: string,
    action: 'withdraw' | 'reject',
    reason: string | null,
    now: Date,
  ): Promise<RequestRow> {
    const row = await this.prisma.$transaction(async (tx) => {
      const request = await this.lockedRequest(tx, { id: requestId, ...scope });
      const step = nextState(request.state, action);
      if ('refused' in step) throw billingRefusal(step.refused);
      const changed = await tx.platformBillingRequest.updateMany({
        where: { id: requestId, state: 'pending' },
        data: {
          state: step.state,
          pendingOrganizationId: null,
          decidedById: actorId,
          decidedAt: now,
          decisionReason: reason,
        },
      });
      if (changed.count === 0) throw billingRefusal('not_pending');

      const bill = await tx.platformBillingBill.findFirst({
        where: { requestId, status: { not: 'cancelled' } },
        orderBy: { number: 'desc' },
      });
      if (bill)
        await this.cancelBill(tx, request, bill, action === 'withdraw' ? 'withdrawn' : 'rejected', now, actorId);

      await this.releaseHold(tx, request, now, actorId, action === 'withdraw' ? 'withdrawn' : 'rejected');
      await this.event(tx, request, now, actorId, action === 'withdraw' ? 'withdrawn' : 'rejected', null, { reason });
      return this.reread(tx, requestId);
    });
    await this.tell(row, action === 'withdraw' ? 'withdrawn' : 'rejected', reason);
    return row;
  }

  /**
   * A hold lasts "until an approver decides" (D9): a request no longer waiting
   * holds nothing, and the access end goes back to exactly what it was before
   * the hold.
   */
  private async releaseHold(
    tx: PlatformBillingTransaction,
    request: RequestRow,
    now: Date,
    actorId: string | null,
    reason: string,
  ): Promise<void> {
    if (request.holdDays <= 0 || !request.accessUntilBeforeHold) return;
    await this.subscriptions.setAccessUntil(
      { organizationId: request.organizationId, accessUntil: request.accessUntilBeforeHold },
      tx,
    );
    await this.event(tx, request, now, actorId, 'hold_ended', reason, {
      accessUntil: request.accessUntilBeforeHold.toISOString(),
    });
  }

  /**
   * The pending requests an archive of `planKey` closes: any request for the
   * plan, and a change away from it (its quote credits the plan's unused days,
   * which the archive credit now pays). A subscribe or replacement FROM the
   * plan is left alone: it prices nothing of the old plan.
   */
  private async pendingNaming(tx: PlatformBillingTransaction, planKey: string): Promise<RequestRow[]> {
    const page = { orderBy: [{ requestedAt: 'asc' as const }, { id: 'asc' as const }], take: ARCHIVE_SWEEP_MAX };
    const [forPlan, awayFrom] = await Promise.all([
      tx.platformBillingRequest.findMany({ where: { state: 'pending', planKey }, ...page }),
      tx.platformBillingRequest.findMany({
        where: { state: 'pending', kind: 'change_plan', fromPlanKey: planKey },
        ...page,
      }),
    ]);
    const byId = new Map([...forPlan, ...awayFrom].map((request) => [request.id, request]));
    return [...byId.values()];
  }

  /** A request the archive made pointless, withdrawn by the system: its bill cancelled, any hold given back. */
  private async withdrawForArchive(tx: PlatformBillingTransaction, request: RequestRow, now: Date): Promise<void> {
    const changed = await tx.platformBillingRequest.updateMany({
      where: { id: request.id, state: 'pending' },
      data: { state: 'withdrawn', pendingOrganizationId: null, decidedAt: now, decisionReason: 'plan_archived' },
    });
    if (changed.count === 0) return;
    const bill = await tx.platformBillingBill.findFirst({
      where: { requestId: request.id, status: { not: 'cancelled' } },
      orderBy: { number: 'desc' },
    });
    if (bill) await this.cancelBill(tx, request, bill, 'plan_archived', now, null);
    await this.releaseHold(tx, request, now, null, 'plan_archived');
    await this.event(tx, request, now, null, 'withdrawn', 'plan_archived', { planKey: request.planKey });
  }

  /** One archive ledger line for a subscription row: the credit, or its reversal. Written by the system. */
  private async archiveEntry(
    tx: PlatformBillingTransaction,
    row: { organizationId: string; subscriptionId: string },
    amount: Centavos,
    kind: 'archive' | 'archive_reversal',
    note: string,
    now: Date,
  ): Promise<void> {
    await tx.platformBillingCredit.create({
      data: {
        organizationId: row.organizationId,
        amount,
        kind,
        requestId: null,
        billId: null,
        receiptId: null,
        subscriptionId: row.subscriptionId,
        note,
        createdById: null,
        createdAt: now,
      },
    });
  }

  /**
   * Tells the notifier of a request's step, AFTER its transaction committed:
   * telling inside it would announce a step that can still roll back. A
   * failure is logged, never thrown: the step already happened, and turning a
   * notification problem into an error would make somebody repeat it.
   */
  private async tell(row: RequestRow, step: BillingRequestStep, reason: string | null): Promise<void> {
    if (!this.notifier) return;
    try {
      await this.notifier.requestChanged({
        organizationId: row.organizationId,
        requestId: row.id,
        kind: row.kind,
        step,
        planKey: row.planKey,
        reason,
      });
    } catch (error) {
      this.logger.warn(
        `The ${step} notice for a billing request could not be sent: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** The subscription write a void makes (`planVoid`), in billing's transaction. */
  private async reverseSubscription(
    tx: PlatformBillingTransaction,
    organizationId: string,
    plan: VoidPlan,
    timeZone: string,
  ): Promise<string> {
    switch (plan.kind) {
      case 'restore_period':
      case 'restore_plan': {
        const write = {
          organizationId,
          periodStart: platformDayStart(plan.period.start, timeZone),
          periodEnd: platformDayStart(plan.period.end, timeZone),
          billingDay: plan.period.billingDay,
          accessUntil: new Date(plan.accessUntil),
        };
        const written =
          plan.kind === 'restore_period'
            ? await this.subscriptions.renew(write, tx)
            : await this.subscriptions.start({ ...write, planKey: plan.planKey }, tx);
        return written.subscriptionId;
      }
      case 'end':
        return (await this.subscriptions.end({ organizationId }, tx)).subscriptionId;
      case 'restore_access':
        return (
          await this.subscriptions.setAccessUntil({ organizationId, accessUntil: new Date(plan.accessUntil) }, tx)
        ).subscriptionId;
    }
  }

  /**
   * Whether `liveId` is the row `request`'s approval wrote: the same id, or
   * the row a void of the NEXT approval started to put this one's plan back
   * (its `subscriptionBefore` names this approval's row). Anything else is a
   * row somebody else wrote.
   */
  private async isApprovalsRow(tx: PlatformBillingTransaction, request: RequestRow, liveId: string): Promise<boolean> {
    if (liveId === request.subscriptionId) return true;
    const restorer = await tx.platformBillingRequest.findFirst({
      where: { organizationId: request.organizationId, state: 'voided', restoredSubscriptionId: liveId },
    });
    if (!restorer) return false;
    return readSubscriptionBefore(restorer.subscriptionBefore)?.subscriptionId === request.subscriptionId;
  }

  /**
   * ⚠ Takes the organization's decision lock in THIS transaction
   * (`PlatformBillingLock`): held until commit, so two decisions about one
   * organization never read its subscription at the same time.
   */
  private async lockOrganization(tx: PlatformBillingTransaction, organizationId: string): Promise<void> {
    await tx.platformBillingLock.upsert({
      where: { organizationId },
      create: { organizationId, version: 1 },
      update: { version: { increment: 1 } },
    });
  }

  /**
   * The request, read again AFTER its organization's lock is taken: the first
   * read only finds the organization, and what a decision checks must be what
   * the previous decision committed.
   */
  private async lockedRequest(
    tx: PlatformBillingTransaction,
    where: { id: string; organizationId?: string },
  ): Promise<RequestRow> {
    const found = await tx.platformBillingRequest.findFirst({ where });
    if (!found) throw billingRefusal('not_found');
    await this.lockOrganization(tx, found.organizationId);
    return this.reread(tx, found.id);
  }

  /** The hold a renewal's first covering details earn (D9). */
  private async holdFor(tx: PlatformBillingTransaction, request: RequestRow, context: BillingContext) {
    const window = context.standing.window;
    if (!window) return { kind: 'not_held', reason: 'no_covering_details' } as const;
    const rejected = request.pricedForPeriodEnd
      ? await tx.platformBillingRequest.findFirst({
          where: {
            organizationId: request.organizationId,
            state: 'rejected',
            kind: 'renew',
            pricedForPeriodEnd: request.pricedForPeriodEnd,
          },
        })
      : null;
    return planHold(
      { periodEnd: window.periodEnd, graceDays: context.settings.graceDays },
      { coveredOn: context.today, holdUsedThisPeriod: window.holdDays > 0, afterRejection: rejected !== null },
    );
  }

  /** What an approval writes to the subscription, by kind (plan §4 "Periods"). */
  private periodFor(
    request: RequestRow,
    context: BillingContext,
  ): { how: 'renew' | 'change' | 'start'; period: Period; accessUntil: DayKey } {
    const grace = context.settings.graceDays;
    const withGrace = (period: Period) => accessWindow(period.end, grace).accessUntil;
    switch (request.kind) {
      case 'subscribe':
      case 'replace': {
        // From approval: that day becomes the billing day.
        const period = periodFrom(context.today);
        return { how: 'start', period, accessUntil: withGrace(period) };
      }
      case 'cancel':
      case 'adjustment':
        // ⚠ Never pending, so never approved here: each is recorded already decided.
        throw billingRefusal('invalid');
      case 'change_plan': {
        // The billing day never moves: the new plan runs to the end of the current period.
        const period = context.standing.currentPeriod;
        if (!period) throw billingRefusal('no_subscription');
        return { how: 'change', period, accessUntil: withGrace(period) };
      }
      case 'renew': {
        const current = context.standing.rowPeriod;
        const window = context.standing.window;
        if (!current || !window) throw billingRefusal('no_subscription');
        const coveredOn = request.coveredOn ? dateColumnToDay(request.coveredOn) : null;
        const plan = planRenewal({ current, window, approvedOn: context.today, onTime: isOnTime(coveredOn, window) });
        // Before access ended, the same row moves on; after, a new period from approval.
        const how = plan.kind === 'continue' ? 'renew' : 'start';
        return { how, period: plan.period, accessUntil: withGrace(plan.period) };
      }
    }
  }

  /** The approval-lag credit of an upgrade approved after the day it was priced (D12). */
  private lagCredit(request: RequestRow, snapshot: BillSnapshot, today: DayKey): Centavos {
    if (request.kind !== 'change_plan' || snapshot.direction !== 'upgrade' || snapshot.oldMonthly === null) return 0;
    const period = snapshot.pricedForPeriod;
    if (!period) return 0;
    return approvalLagCredit(
      { oldMonthly: snapshot.oldMonthly, newMonthly: snapshot.monthly, period },
      snapshot.pricedOn,
      today,
    );
  }

  /** Issues a bill for `priced`: its number taken in this transaction, its snapshot frozen. */
  private async issueBill(
    tx: PlatformBillingTransaction,
    request: RequestRow,
    context: BillingContext,
    priced: PricedRequest,
    now: Date,
    actorId: string,
  ): Promise<BillRow> {
    const number = await this.nextNumber(tx, 'bill');
    const plan = context.plans.get(request.planKey);
    const fromPlan = request.fromPlanKey ? context.plans.get(request.fromPlanKey) : undefined;
    const snapshot = billSnapshot({
      number: documentNumber('bill', number),
      kind: request.kind,
      organizationId: request.organizationId,
      plan: { key: request.planKey, label: plan?.label ?? request.planKey },
      fromPlan: request.fromPlanKey
        ? { key: request.fromPlanKey, label: fromPlan?.label ?? request.fromPlanKey }
        : null,
      quote: priced.quote,
      monthly: priced.monthly,
      oldMonthly: priced.oldMonthly,
      direction: priced.direction,
      pricedOn: context.today,
      pricedForPeriod: priced.period,
      currency: context.settings.currency,
      issuer: context.settings.issuer,
      issuedOn: context.today,
    });
    const bill = await tx.platformBillingBill.create({
      data: {
        requestId: request.id,
        organizationId: request.organizationId,
        number,
        status: 'unpaid',
        total: priced.quote.total,
        currency: context.settings.currency,
        snapshot,
        issuedAt: now,
      },
    });
    await this.event(tx, request, now, actorId, 'bill_issued', null, { number, total: priced.quote.total });
    return bill;
  }

  /** A bill cancelled with its reason. It keeps its number, so numbering keeps no gap. */
  private async cancelBill(
    tx: PlatformBillingTransaction,
    request: RequestRow,
    bill: BillRow,
    reason: string,
    now: Date,
    actorId: string | null,
    data: Record<string, JsonValue> = {},
  ): Promise<void> {
    await tx.platformBillingBill.update({
      where: { id: bill.id },
      data: { status: 'cancelled', cancelledAt: now, cancelledReason: reason },
    });
    await this.event(tx, request, now, actorId, 'bill_cancelled', reason, { number: bill.number, ...data });
  }

  /** The request as the transaction now holds it: what the caller renders. */
  private async reread(tx: PlatformBillingTransaction, requestId: string): Promise<RequestRow> {
    const row = await tx.platformBillingRequest.findFirst({ where: { id: requestId } });
    if (!row) throw billingRefusal('not_found');
    return row;
  }

  /** ⚠ The next number of `sequence`, taken under the counter row's lock in THIS transaction. */
  private async nextNumber(tx: PlatformBillingTransaction, sequence: 'bill' | 'receipt'): Promise<number> {
    const counter = await tx.platformBillingCounter.upsert({
      where: { sequence },
      create: { sequence, value: 1 },
      update: { value: { increment: 1 } },
    });
    return counter.value;
  }

  private async event(
    tx: PlatformBillingTransaction,
    request: Pick<RequestRow, 'id' | 'organizationId'>,
    at: Date,
    actorId: string | null,
    step: string,
    reason: string | null,
    data: Record<string, JsonValue>,
  ): Promise<void> {
    await tx.platformBillingEvent.create({
      data: { requestId: request.id, organizationId: request.organizationId, at, actorId, step, reason, data },
    });
  }
}

/**
 * The live row as it was before an approval or a cancel: what a void puts
 * back. The period is the one billing reads off the row (derived for a row
 * written before billing), and the access end is the row's own instant, so a
 * void restores it exactly.
 *
 * ⚠ EXCEPT THE REQUEST'S OWN HOLD. A hold lasts until an approver decides
 * (D9), and the approval is that decision: the access end to put back is the
 * one before the hold, as a rejection gives back. Restoring the held instant
 * would hand a voided renewal the days it only had while waiting.
 */
function beforeOf(context: BillingContext, request: RequestRow | null): SubscriptionBefore | null {
  const live = context.live;
  if (!live) return null;
  const period = context.standing.rowPeriod;
  const window = context.standing.window;
  const held = request && request.holdDays > 0 ? request.accessUntilBeforeHold : null;
  const accessUntil =
    held ?? live.accessUntil ?? (window ? platformDayStart(window.accessUntil, context.settings.timeZone) : null);
  return {
    subscriptionId: live.subscriptionId,
    planKey: live.planKey,
    periodStart: period?.start ?? null,
    periodEnd: period?.end ?? null,
    billingDay: period?.billingDay ?? null,
    accessUntil: accessUntil?.toISOString() ?? null,
  };
}

/**
 * Whether the live row is still in the state the approval (or cancel) left
 * it: its plan, its period end and its access end. A row edited since by an
 * admin, a later hold or anything else keeps its id but not this, and a void
 * would overwrite that edit with the values from before the approval.
 */
function leftAsApproved(live: BillingSubscriptionRow, request: RequestRow, timeZone: string): boolean {
  if (!request.accessUntil || !live.accessUntil || !request.periodEnd || !live.currentPeriodEnd) return false;
  if (live.accessUntil.getTime() !== request.accessUntil.getTime()) return false;
  if (live.planKey !== request.planKey) return false;
  return platformDay(live.currentPeriodEnd, timeZone) === dateColumnToDay(request.periodEnd);
}

/**
 * `subscriptionBefore` as the update takes it: absent when nothing was live
 * (the column stays NULL), and a spread copy otherwise, since an interface
 * carries no index signature and a JSON column wants one.
 */
function asJson(before: SubscriptionBefore | null): { subscriptionBefore?: JsonInput } {
  return before ? { subscriptionBefore: { ...before } } : {};
}

/** Details as stored: validated, the reference normalised for the reuse check. */
function preparePayment(input: PaymentDetailsInput): {
  method: PaymentMethod;
  amount: number;
  paidOn: Date;
  reference: string | null;
  referenceNormalised: string | null;
  sender: string | null;
  note: string | null;
} {
  if (!isPaymentMethod(input.method)) throw billingRefusal('invalid', { field: 'method' });
  if (!Number.isSafeInteger(input.amount) || input.amount < 0) throw billingRefusal('invalid', { field: 'amount' });
  if (!isDayKey(input.paidOn)) throw billingRefusal('invalid', { field: 'paidOn' });
  const reference = prepareText(input.reference ?? null);
  if (needsReference(input.method) && !reference) throw billingRefusal('reference_required');
  return {
    method: input.method,
    amount: input.amount,
    paidOn: dayToDateColumn(input.paidOn),
    reference,
    referenceNormalised: reference ? normaliseReference(reference) : null,
    sender: prepareText(input.sender ?? null),
    note: prepareText(input.note ?? null),
  };
}

/** Free text trimmed; empty is absent; too long is refused, never cut. */
function prepareText(value: string | null, max = PLATFORM_BILLING_TEXT_MAX): string | null {
  const text = value?.trim() ?? '';
  if (!text) return null;
  if (text.length > max) throw billingRefusal('invalid', { max });
  return text;
}

/** P2002, detected structurally: this module never imports Prisma. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
