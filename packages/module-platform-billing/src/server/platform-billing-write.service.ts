import { isValidTimeZone } from '@kwtech/module-kit';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { accessWindow, isOnTime, planHold, planRenewal } from '../domain/access.js';
import { addDays, type DayKey, isDayKey, platformDayStart } from '../domain/days.js';
import { type BillSnapshot, billSnapshot, type ReceiptSnapshot, readBillSnapshot } from '../domain/documents.js';
import type { Centavos } from '../domain/money.js';
import { isPaymentMethod, needsReference, normaliseReference, type PaymentMethod } from '../domain/payments.js';
import { type Period, periodFrom } from '../domain/periods.js';
import { chargesAccessUsed, isRefused, type PricedRequest, priceRequest } from '../domain/pricing.js';
import { approvalLagCredit } from '../domain/quotes.js';
import { checkApproval, nextState, type RequestKind } from '../domain/requests.js';
import { documentNumber } from '../domain/standing.js';
import { billingRefusal } from './platform-billing.errors.js';
import {
  type BillRow,
  dateColumnToDay,
  dayToDateColumn,
  type JsonValue,
  type PlatformBillingTransaction,
  type PlatformBillingWriteClient,
  type RequestRow,
} from './platform-billing.repository.js';
import {
  type BillingContext,
  PLATFORM_BILLING_SETTINGS_ID,
  PlatformBillingService,
} from './platform-billing.service.js';
import {
  PLATFORM_BILLING_PEOPLE,
  PLATFORM_BILLING_PRISMA_WRITE,
  PLATFORM_BILLING_SUBSCRIPTIONS,
} from './platform-billing.tokens.js';
import type { PlatformBillingPeople, PlatformBillingSubscriptions } from './ports.js';

/** The kinds a person may request through this service. Cancel arrives with phase 4b. */
export type SubmittableKind = Exclude<RequestKind, 'cancel'>;

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
  ) {}

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
    return this.prisma.$transaction(async (tx) => {
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
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.platformBillingRequest.findFirst({ where: { id: requestId, organizationId } });
      if (!request) throw billingRefusal('not_found');
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
            if (held > window.accessUntil) {
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
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.platformBillingRequest.findFirst({ where: { id: requestId } });
      if (!request) throw billingRefusal('not_found');
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
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.platformBillingRequest.findFirst({ where: { id: requestId, ...scope } });
      if (!request) throw billingRefusal('not_found');
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

      // A hold lasts "until an approver decides" (D9): a request no longer waiting holds nothing.
      if (request.holdDays > 0) {
        const context = await this.reads.context(request.organizationId, now, tx);
        const window = context.standing.window;
        if (window) {
          const back = addDays(window.periodEnd, context.settings.graceDays);
          await this.subscriptions.setAccessUntil(
            { organizationId: request.organizationId, accessUntil: platformDayStart(back, context.settings.timeZone) },
            tx,
          );
          await this.event(tx, request, now, actorId, 'hold_ended', action === 'withdraw' ? 'withdrawn' : 'rejected', {
            accessUntil: back,
          });
        }
      }
      await this.event(tx, request, now, actorId, action === 'withdraw' ? 'withdrawn' : 'rejected', null, { reason });
      return this.reread(tx, requestId);
    });
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
      case 'replace':
      case 'cancel': {
        // From approval: that day becomes the billing day.
        const period = periodFrom(context.today);
        return { how: 'start', period, accessUntil: withGrace(period) };
      }
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
    actorId: string,
  ): Promise<void> {
    await tx.platformBillingBill.update({
      where: { id: bill.id },
      data: { status: 'cancelled', cancelledAt: now, cancelledReason: reason },
    });
    await this.event(tx, request, now, actorId, 'bill_cancelled', reason, { number: bill.number });
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
