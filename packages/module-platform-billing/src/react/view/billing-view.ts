import { DEFAULT_TIME_ZONE, isValidTimeZone, zonedDayKey } from '@kwtech/module-kit';
import type {
  BillingEventView,
  BillingOverviewView,
  BillingPlanOfferView,
  BillingStandingView,
} from '../billing-client.js';

/**
 * THE BILLING PAGE'S RULES, as pure functions (frontend rules: view logic in
 * `react/view/*.ts`, unit-tested). What the top of the page says, which one
 * main button it shows, and why a control is off: every refusal and every
 * surprising allowance in words, with the next step (plan §6).
 */

/** What the person viewing may do, from the keys their role holds (D8). The API authorises again. */
export interface BillingAbilities {
  /** `platform-billing:change_plan`: subscribe, change, replace, cancel (the owner's). */
  choosePlan: boolean;
  /** `platform-billing:renew`. */
  renew: boolean;
  /** `platform-billing:enter_payment`: add payment details, withdraw. */
  enterPayment: boolean;
}

/** How loud the status is. */
export type BillingTone = 'ok' | 'info' | 'warning' | 'alert';

/** The top of the page: one headline, and the sentences that explain it. */
export interface BillingStatusView {
  tone: BillingTone;
  headline: string;
  /** Why access lasts as long as it does, and anything unusual about it. */
  details: string[];
}

/** The one main button, following the status. */
export type BillingMainAction =
  | { kind: 'renew' | 'subscribe' | 'replace'; label: string; disabledReason: string | null }
  /** A request is waiting: the page shows it instead of a button. */
  | { kind: 'pending'; label: string; disabledReason: null };

/** Whether a secondary control is on, and the words when it is not. */
export interface BillingControl {
  enabled: boolean;
  reason: string | null;
}

const OWNER_ONLY = "Only the organization's owner can choose, change or cancel the plan.";
const NO_RENEW = 'Your role does not include renewing. Ask the owner or an admin.';

/** Centavos as money: `₱1,000.00`. An unknown currency code falls back to the code and the number. */
export function formatMoney(centavos: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency }).format(centavos / 100);
  } catch {
    return `${currency} ${(centavos / 100).toFixed(2)}`;
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * A day key (`YYYY-MM-DD`) for people: `1 Dec 2026`. Spelled out by hand
 * rather than by a locale, whose order and punctuation differ between
 * browsers and runtimes; a calendar day has no zone to apply.
 */
export function formatDay(day: string | null): string {
  if (!day) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) return day;
  return `${Number(match[3])} ${month} ${match[1]}`;
}

/**
 * An instant as its day in the billing time zone: `1 Dec 2026`. Never the
 * browser's zone, which would date an evening payment a day later for some
 * viewers. An unknown zone falls back to `DEFAULT_TIME_ZONE`, never UTC.
 */
export function formatInstantDay(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // module-kit's one rule for "which day is this instant", and its fallback zone, never UTC.
  return formatDay(zonedDayKey(date, isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE));
}

/**
 * The day `now` is in the billing time zone, as a day key: what the platform's
 * forms start their dates from. An unknown zone falls back to
 * `DEFAULT_TIME_ZONE`, never UTC.
 */
export function billingDayOf(now: Date, timeZone: string): string {
  return zonedDayKey(now, isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE);
}

/** `1 day`, `3 days`. */
function days(count: number | null): string {
  const value = count ?? 0;
  return value === 1 ? '1 day' : `${value} days`;
}

/** The day before a day key: the last day an `accessUntil` (the first day without access) covers. */
function dayBefore(day: string | null): string | null {
  if (!day) return null;
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** The top of the page for `overview`: the plan's state, and the rule behind every date it gives. */
export function billingStatus(
  overview: Pick<BillingOverviewView, 'standing' | 'creditBalance' | 'currency'>,
): BillingStatusView {
  const s = overview.standing;
  const plan = s.planLabel ?? 'your plan';
  const lastDay = formatDay(dayBefore(s.accessUntil));
  const details: string[] = [];
  const credit = overview.creditBalance;
  if (credit > 0) details.push(`Credit of ${formatMoney(credit, overview.currency)} is applied to your next bill.`);
  if (credit < 0) details.push(`${formatMoney(-credit, overview.currency)} is owed and added to your next bill.`);

  if (s.planArchived) {
    return {
      tone: 'alert',
      headline: `${plan} is no longer offered`,
      details: [
        'It gives no access any more. Choose a replacement plan; any paid days it lost were added as credit.',
        ...details,
      ],
    };
  }
  if (s.trial) {
    return {
      tone: 'info',
      headline: `Trial of ${plan}`,
      details: [
        `Free until ${lastDay}, with no grace after it. Subscribe to keep using it; afterwards the organization goes back to the free plan.`,
        ...details,
      ],
    };
  }
  switch (s.kind) {
    case 'none':
      return {
        tone: 'info',
        headline: 'No paid plan',
        details: ['The organization uses the free plan. Subscribe to a plan to unlock more.', ...details],
      };
    case 'active':
    case 'renewal_open': {
      if (s.cancelled) {
        return {
          tone: 'warning',
          headline: `${plan} ends on ${formatDay(s.periodEnd)}`,
          details: ['You cancelled it, so access ends with the period, without grace. Renew to keep it.', ...details],
        };
      }
      const due = `Due on ${formatDay(s.periodEnd)}, in ${days(s.days)}.`;
      const open =
        s.kind === 'renewal_open'
          ? 'Renewing is open.'
          : `Renewing opens 7 days before the due date. After it, ${days(s.graceDays)} of grace keep access while you pay.`;
      const ahead = s.prepaid ? 'The next month is already paid.' : null;
      return {
        tone: s.kind === 'renewal_open' ? 'warning' : 'ok',
        headline: `${plan} is active`,
        details: [due, open, ...(ahead ? [ahead] : []), ...details],
      };
    }
    case 'overdue':
      return {
        tone: 'warning',
        headline: `${plan} is overdue: ${days(s.days)} of access left`,
        details: [
          `It was due on ${formatDay(s.periodEnd)}. Access lasts until ${lastDay}: the due date plus ${days(s.graceDays)} of grace.`,
          'Renew and add your payment details before then.',
          ...details,
        ],
      };
    case 'held':
      return {
        tone: 'info',
        headline: `${plan} is held while we check your payment`,
        details: [
          `Access lasts until ${lastDay}: the due date plus ${days(s.graceDays)} of grace and ${days(s.holdDays)} held, because your payment details came in before grace ended.`,
          ...details,
        ],
      };
    case 'expired':
      return {
        tone: 'alert',
        headline: `${plan} ended on ${lastDay}`,
        details: [
          'The organization is back on the free plan; nothing was deleted. Billing stays open so you can renew, and the access used after the due date is charged on the renewal.',
          ...details,
        ],
      };
    default:
      return { tone: 'info', headline: plan, details };
  }
}

/** The one main button for `overview`, and why it is off when it is. */
export function mainAction(
  overview: Pick<BillingOverviewView, 'standing' | 'pending'>,
  can: BillingAbilities,
): BillingMainAction {
  const s = overview.standing;
  if (overview.pending) return { kind: 'pending', label: 'Request waiting', disabledReason: null };
  if (s.planArchived) {
    return { kind: 'replace', label: 'Choose a replacement plan', disabledReason: can.choosePlan ? null : OWNER_ONLY };
  }
  if (s.trial || s.kind === 'none') {
    return { kind: 'subscribe', label: 'Choose a plan', disabledReason: can.choosePlan ? null : OWNER_ONLY };
  }
  if (!can.renew) return { kind: 'renew', label: 'Renew', disabledReason: NO_RENEW };
  if (s.kind === 'active' && !s.cancelled) {
    return {
      kind: 'renew',
      label: 'Renew',
      disabledReason: `Renewing opens on ${formatDay(sevenDaysBefore(s.periodEnd))}, 7 days before the due date. You will be reminded.`,
    };
  }
  return { kind: 'renew', label: s.kind === 'expired' ? 'Renew to restore access' : 'Renew', disabledReason: null };
}

/** Whether Change plan is offered, and why not (D8, "Renew first"). */
export function changePlanControl(
  overview: Pick<BillingOverviewView, 'standing' | 'pending'>,
  can: BillingAbilities,
): BillingControl {
  const s = overview.standing;
  if (s.trial || s.kind === 'none' || s.planArchived) return { enabled: false, reason: null };
  if (!can.choosePlan) return { enabled: false, reason: OWNER_ONLY };
  if (overview.pending) return { enabled: false, reason: 'A request is already waiting. Finish or withdraw it first.' };
  if (s.kind === 'overdue' || s.kind === 'held' || s.kind === 'expired') {
    return { enabled: false, reason: 'Your subscription is overdue, so the plan cannot be changed yet. Renew first.' };
  }
  return { enabled: true, reason: null };
}

/** Whether Cancel is offered, and why not. */
export function cancelControl(
  overview: Pick<BillingOverviewView, 'standing' | 'pending'>,
  can: BillingAbilities,
): BillingControl {
  const s = overview.standing;
  if (s.trial || s.kind === 'none' || s.kind === 'expired' || s.planArchived) return { enabled: false, reason: null };
  if (s.cancelled)
    return { enabled: false, reason: 'Already set to end at the close of the period. Renew to keep it.' };
  if (!can.choosePlan) return { enabled: false, reason: OWNER_ONLY };
  if (overview.pending) return { enabled: false, reason: 'A request is already waiting. Finish or withdraw it first.' };
  return { enabled: true, reason: null };
}

/** The day renewing opens: 7 days before the due date. */
function sevenDaysBefore(day: string | null): string | null {
  if (!day) return null;
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 7);
  return date.toISOString().slice(0, 10);
}

/** A request's kind, for people. */
export function requestKindLabel(kind: string): string {
  switch (kind) {
    case 'subscribe':
      return 'Subscribe';
    case 'renew':
      return 'Renewal';
    case 'change_plan':
      return 'Plan change';
    case 'replace':
      return 'Replacement plan';
    case 'cancel':
      return 'Cancel';
    case 'adjustment':
      return 'Adjustment by our staff (no payment)';
    default:
      return kind;
  }
}

/** A request's state, for people. */
export function requestStateLabel(state: string): string {
  switch (state) {
    case 'pending':
      return 'Waiting for approval';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'withdrawn':
      return 'Withdrawn';
    case 'voided':
      return 'Reversed';
    case 'closed_as_credit':
      return 'Kept as credit';
    default:
      return state;
  }
}

/** A bill's stamp (plan §7). */
export function billStatusLabel(status: string): string {
  switch (status) {
    case 'unpaid':
      return 'Unpaid';
    case 'submitted':
      return 'Payment submitted, pending verification';
    case 'paid':
      return 'Paid';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

/** A bill line, for people. */
export function lineLabel(kind: string, lineDays: number | null): string {
  const counted = lineDays ? ` (${days(lineDays)})` : '';
  switch (kind) {
    case 'month':
      return 'One month';
    case 'new_plan_days':
      return `New plan for the rest of the period${counted}`;
    case 'old_plan_unused':
      return `Unused days of the current plan${counted}`;
    case 'prepaid_month':
      return 'Month already paid ahead, given back';
    case 'access_used':
      return `Access used after the due date${counted}`;
    case 'credit_applied':
      return 'Credit applied';
    case 'owed':
      return 'Owed from before';
    default:
      return kind;
  }
}

/** How a payment was sent, for people. */
export function paymentMethodLabel(method: string): string {
  switch (method) {
    case 'cash':
      return 'Cash';
    case 'e_wallet':
      return 'E-wallet';
    case 'bank_transfer':
      return 'Bank transfer';
    default:
      return method;
  }
}

/** Why a bill was cancelled, for people. */
function cancelledWhy(reason: string | null): string {
  switch (reason) {
    case 'withdrawn':
      return 'the request was withdrawn';
    case 'rejected':
      return 'the request was rejected';
    case 'access_ended_before_details':
      return 'access ended before payment details were entered, so a new bill charges the access used';
    case 'closed_as_credit':
      return 'the payment was kept as credit';
    case 'plan_archived':
      return 'the plan was withdrawn';
    default:
      return reason ?? 'it was cancelled';
  }
}

/** One step of a request's timeline, in words, with its reason (plan §6: the history explains itself). */
export function eventSentence(event: Pick<BillingEventView, 'step' | 'reason' | 'data'>, currency: string): string {
  const data = readData(event.data);
  const money = (key: string) => (typeof data[key] === 'number' ? formatMoney(data[key] as number, currency) : '');
  const number = typeof data.number === 'number' ? String(data.number).padStart(6, '0') : '';
  switch (event.step) {
    case 'submitted':
      return 'Requested.';
    case 'bill_issued':
      return `Bill B-${number} issued for ${money('total')}.`;
    case 'bill_deferred':
      return 'A downgrade is billed on the day it is approved, with that day’s credit.';
    case 'bill_cancelled':
      return `Bill B-${number} cancelled: ${cancelledWhy(event.reason)}.`;
    case 'bill_unpaid':
      return `Bill B-${number} is unpaid again: its approval was reversed.`;
    case 'details_entered':
      return `Payment details entered: ${money('amount')}.`;
    case 'hold_given':
      return `Access held ${days(typeof data.days === 'number' ? data.days : null)} while we check the payment: it came in before grace ended.`;
    case 'hold_not_given':
      return 'No hold this time: one was already given this period, or a renewal was rejected.';
    case 'hold_ended':
      return 'The hold ended with the decision.';
    case 'approved':
      return event.reason === 'cancel_needs_no_approval'
        ? 'Cancelled: access ends at the close of the period.'
        : event.reason === 'self_approved'
          ? 'Approved by the person who made it.'
          : 'Approved: the payment was confirmed.';
    case 'receipt_issued':
      return `Receipt R-${number} issued for ${money('amount')}.`;
    case 'receipt_voided':
      return `Receipt R-${number} voided.`;
    case 'credit':
      return `Credit ${typeof data.amount === 'number' && data.amount < 0 ? 'used' : 'added'}: ${money('amount')}.`;
    case 'rejected':
      return `Rejected.${typeof data.reason === 'string' ? ` ${data.reason}` : ''}`;
    case 'withdrawn':
      return event.reason === 'plan_archived' ? 'Withdrawn by us: the plan was withdrawn.' : 'Withdrawn.';
    case 'voided':
      return `Approval reversed.${typeof data.reason === 'string' ? ` ${data.reason}` : ''}`;
    case 'closed_as_credit':
      return `The payment of ${money('received')} was kept as credit: the request could not be applied.`;
    case 'adjusted':
      return `Adjusted by our staff, with no payment.${typeof data.reason === 'string' ? ` ${data.reason}` : ''}`;
    default:
      return event.step;
  }
}

/** A timeline step's JSON inputs, or none when they do not parse. */
function readData(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The standing's own words for the history header: kept short. */
export function standingWord(standing: Pick<BillingStandingView, 'kind' | 'trial'>): string {
  if (standing.trial) return 'Trial';
  switch (standing.kind) {
    case 'active':
    case 'renewal_open':
      return 'Active';
    case 'overdue':
      return 'Overdue';
    case 'held':
      return 'Held';
    case 'expired':
      return 'Expired';
    default:
      return 'Free';
  }
}

/**
 * The plans a request may name, by what it is (`PlanRequest`'s list):
 * - only a plan CHANGE leaves the current plan out: a trial's owner
 *   subscribes to the plan they are trying;
 * - a plan change and a replacement may go to a plan priced at zero (it has
 *   a price, of nothing): leaving a paid plan for it is allowed;
 * - a subscribe is to a paid plan: the free plan is what the organization is
 *   already on without one.
 * An archived plan, and one with no price at all, are never offered.
 */
export function planChoices(
  plans: readonly BillingPlanOfferView[],
  mode: 'renew' | 'subscribe' | 'change_plan' | 'replace',
): BillingPlanOfferView[] {
  const zeroAllowed = mode === 'change_plan' || mode === 'replace';
  return plans.filter(
    (plan) =>
      plan.monthly !== null &&
      (zeroAllowed ? plan.monthly >= 0 : plan.monthly > 0) &&
      !plan.archived &&
      (mode !== 'change_plan' || !plan.current),
  );
}

/**
 * The stamp a printed document carries (plan §7): a bill's status in
 * capitals, PAID with the receipt that paid it; a receipt VOID when it was
 * reversed, and otherwise none.
 */
export function documentStamp(
  document: { kind: 'bill'; status: string; paidBy: string | null } | { kind: 'receipt'; voided: boolean },
): string | null {
  if (document.kind === 'receipt') return document.voided ? 'VOID' : null;
  switch (document.status) {
    case 'unpaid':
      return 'UNPAID';
    case 'submitted':
      return 'PAYMENT SUBMITTED, PENDING VERIFICATION';
    case 'paid':
      return document.paidBy ? `PAID, RECEIPT ${document.paidBy}` : 'PAID';
    case 'cancelled':
      return 'CANCELLED';
    default:
      return document.status.toUpperCase();
  }
}
