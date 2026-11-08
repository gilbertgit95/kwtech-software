import type { Centavos } from './money.js';
import type { PlatformBillingRefusal } from './refusals.js';

/**
 * A REQUEST AND WHAT MAY HAPPEN TO IT (PLATFORM-BILLING-PLAN §4). Every month
 * of a subscription is a request we approve; this is its state machine and the
 * checks each step runs, as values, so the server refuses and the page explains
 * from the same answer.
 */

/** What an organization asks for. */
export type RequestKind =
  /** No plan yet (or only Free): choose one. */
  | 'subscribe'
  /** The same plan for another month. */
  | 'renew'
  /** An upgrade or downgrade in the middle of a period. */
  | 'change_plan'
  /** The current plan was archived: choose another, at any standing. */
  | 'replace'
  /** End at the period's end. */
  | 'cancel'
  /**
   * Not asked for by the organization: a subscription written by hand on the
   * admin screens, with no payment (D5). Recorded already decided, with the
   * admin's reason, so the history shows it; never priced, never voided.
   */
  | 'adjustment';

/** The kinds an organization asks for and billing prices: not a cancel (priced at nothing) nor an adjustment. */
export type PricedKind = Exclude<RequestKind, 'cancel' | 'adjustment'>;

export type RequestState = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'voided' | 'closed_as_credit';

export type RequestAction = 'edit_details' | 'approve' | 'reject' | 'withdraw' | 'close_as_credit' | 'void';

/** The actions `state` allows. Only a pending request moves; only an approved one can be voided. */
export function allowedActions(state: RequestState): readonly RequestAction[] {
  switch (state) {
    case 'pending':
      return ['edit_details', 'approve', 'reject', 'withdraw', 'close_as_credit'];
    case 'approved':
      return ['void'];
    case 'rejected':
    case 'withdrawn':
    case 'voided':
    case 'closed_as_credit':
      return [];
  }
}

/** The state `action` leads to from `state`, or the refusal. */
export function nextState(
  state: RequestState,
  action: RequestAction,
): { state: RequestState } | { refused: PlatformBillingRefusal } {
  if (!allowedActions(state).includes(action)) {
    // A void asks for an approval; everything else for a request still waiting.
    if (action === 'void') return { refused: 'not_approved' };
    return { refused: state === 'pending' ? 'invalid' : 'not_pending' };
  }
  switch (action) {
    case 'edit_details':
      return { state };
    case 'approve':
      return { state: 'approved' };
    case 'reject':
      return { state: 'rejected' };
    case 'withdraw':
      return { state: 'withdrawn' };
    case 'close_as_credit':
      return { state: 'closed_as_credit' };
    case 'void':
      return { state: 'voided' };
  }
}

/** The kinds only the owner may request (D8). An admin renews and adds payment details. */
export const OWNER_ONLY_KINDS: readonly RequestKind[] = ['subscribe', 'change_plan', 'replace', 'cancel'];

/** Where the organization stands, as the request rules need it. */
export interface RequestStanding {
  /** No live subscription, or only a free one: there is nothing to renew or change. */
  hasPaidSubscription: boolean;
  overdueOrExpired: boolean;
  currentPlanArchived: boolean;
  renewalOpen: boolean;
  hasPendingRequest: boolean;
  /**
   * The owner cancelled: access ends at the period's end. Renewing is open at
   * once (not only from 7 days before), because renewing is how a cancel is
   * undone.
   */
  cancelled: boolean;
}

/** The plan a request names. */
export interface RequestedPlan {
  key: string;
  isPublic: boolean;
  archived: boolean;
}

/** The inputs of a new request. */
export interface NewRequestInput {
  kind: RequestKind;
  actorIsOwner: boolean;
  standing: RequestStanding;
  currentPlanKey: string | null;
  plan: RequestedPlan | null;
  /** The caps the organization is over on the requested plan (see `capsBlockingDowngrade`). */
  overCaps: number;
}

/**
 * Whether a request may be submitted. The first refusal that applies, in the
 * order a person would fix them: who you are, what is already waiting, then the
 * request itself.
 */
export function checkNewRequest(input: NewRequestInput): PlatformBillingRefusal | null {
  if (OWNER_ONLY_KINDS.includes(input.kind) && !input.actorIsOwner) return 'owner_only';
  if (input.standing.hasPendingRequest) return 'pending_request_exists';
  const plan = input.plan;
  switch (input.kind) {
    case 'cancel': {
      if (!input.standing.hasPaidSubscription) return 'no_subscription';
      return input.standing.cancelled ? 'already_cancelled' : null;
    }
    case 'renew': {
      if (!input.standing.hasPaidSubscription) return 'no_subscription';
      if (input.standing.currentPlanArchived) return 'plan_archived';
      const open = input.standing.renewalOpen || input.standing.overdueOrExpired || input.standing.cancelled;
      return open ? null : 'renewal_not_open';
    }
    case 'replace': {
      if (!input.standing.currentPlanArchived) return 'invalid';
      return checkChosenPlan(plan, input.currentPlanKey, input.overCaps);
    }
    case 'subscribe': {
      if (input.standing.hasPaidSubscription && !input.standing.overdueOrExpired) return 'already_subscribed';
      return checkChosenPlan(plan, input.currentPlanKey, input.overCaps);
    }
    case 'adjustment':
      // Written by the admin screens, never requested.
      return 'invalid';
    case 'change_plan': {
      if (!input.standing.hasPaidSubscription) return 'no_subscription';
      if (input.standing.currentPlanArchived) return 'plan_archived';
      if (input.standing.overdueOrExpired) return 'renew_first';
      if (plan && plan.key === input.currentPlanKey) return 'same_plan';
      return checkChosenPlan(plan, input.currentPlanKey, input.overCaps);
    }
  }
}

/** A plan someone chooses: public, not archived, and one the organization fits in (D6). */
function checkChosenPlan(
  plan: RequestedPlan | null,
  currentPlanKey: string | null,
  overCaps: number,
): PlatformBillingRefusal | null {
  if (!plan) return 'not_found';
  if (plan.archived) return 'plan_archived';
  // A plan withdrawn from sale is renewed by those on it, and given to others only by an approver.
  if (!plan.isPublic && plan.key !== currentPlanKey) return 'plan_not_offered';
  if (overCaps > 0) return 'over_new_plan_caps';
  return null;
}

/** What the approver confirms, against what the request says. */
export interface ApprovalInput {
  state: RequestState;
  /** The payment-details version the approver reviewed, and the request's current one. */
  detailsVersionSeen: number;
  detailsVersion: number;
  received: Centavos;
  total: Centavos;
  /** For a plan change: the period end it was priced for, and the current one. */
  pricedForPeriodEnd?: string;
  currentPeriodEnd?: string;
  /** The requested plan was archived after the request was made. */
  planArchived: boolean;
}

/**
 * Whether a request can be approved now. Approval is the judgement "we were
 * paid", so a short payment, a stale view of the details or an expired quote
 * each refuse it with the reason the approver sees (§6).
 */
export function checkApproval(input: ApprovalInput): PlatformBillingRefusal | null {
  if (input.state !== 'pending') return 'not_pending';
  if (input.detailsVersionSeen !== input.detailsVersion) return 'details_changed';
  if (input.planArchived) return 'plan_archived';
  if (input.pricedForPeriodEnd !== undefined && input.pricedForPeriodEnd !== input.currentPeriodEnd) {
    return 'quote_expired';
  }
  if (input.received < input.total) return 'payment_short';
  return null;
}

/** An approved request of a period, newest last. */
export interface ApprovedInPeriod {
  requestId: string;
  approvedAt: string;
}

/**
 * Whether `requestId` may be voided: only the latest approved request, so
 * voiding an earlier plan change never puts a plan back over a later paid one
 * (plan §4, D9a). The rest wait, newest first.
 *
 * The service passes the ORGANIZATION's approvals, not only the period's: a
 * renewal into the next period rests on the approval before it just as a
 * later plan change does, and undoing the earlier one under it would leave
 * the later one extending a period that no longer exists.
 */
export function checkVoid(
  requestId: string,
  approvedInPeriod: readonly ApprovedInPeriod[],
): PlatformBillingRefusal | null {
  const latest = [...approvedInPeriod].sort((a, b) => a.approvedAt.localeCompare(b.approvedAt)).at(-1);
  if (!latest || !approvedInPeriod.some((one) => one.requestId === requestId)) return 'not_found';
  return latest.requestId === requestId ? null : 'void_not_latest';
}
