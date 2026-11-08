'use client';

import { PLATFORM_BILLING_OPERATIONS } from '../operations.js';

/**
 * The Billing page's client: the GraphQL documents of `src/operations.ts`,
 * sent through the app's `/api/auth/graphql` route handler (the browser never
 * holds a token). Each view below mirrors what a document selects, so a field
 * renamed on the server fails `apps/web-server/test/module-operations.test.ts`
 * before it fails here.
 */

export const DEFAULT_GRAPHQL_PATH = '/api/auth/graphql';

/** One line of a bill: what it is, its amount in centavos, and the days it counts when prorated. */
export interface BillingLineView {
  kind: string;
  amount: number;
  days: number | null;
}

export interface BillingBillView {
  id: string;
  /** As printed: `B-000012`. */
  number: string;
  /** `unpaid`, `submitted`, `paid`, `cancelled`. */
  status: string;
  total: number;
  currency: string;
  issuedAt: string;
  planLabel: string;
  fromPlanLabel: string | null;
  lines: BillingLineView[];
  cancelledAt: string | null;
  cancelledReason: string | null;
}

export interface BillingReceiptView {
  id: string;
  number: string;
  amount: number;
  currency: string;
  method: string;
  /** `payment` or `closed_as_credit`. */
  kind: string;
  reference: string | null;
  issuedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface BillingPaymentView {
  version: number;
  method: string;
  amount: number;
  paidOn: string;
  reference: string | null;
  sender: string | null;
  note: string | null;
  enteredById: string;
  enteredAt: string;
}

export interface BillingEventView {
  id: string;
  at: string;
  step: string;
  reason: string | null;
  actorId: string | null;
  /** JSON-encoded inputs of the step (days, amounts, dates). */
  data: string;
}

export interface BillingRequestView {
  id: string;
  organizationId: string;
  /** `subscribe`, `renew`, `change_plan`, `replace`, `cancel`, `adjustment`. */
  kind: string;
  /** `pending`, `approved`, `rejected`, `withdrawn`, `voided`, `closed_as_credit`. */
  state: string;
  planKey: string;
  fromPlanKey: string | null;
  requestedById: string;
  requestedAt: string;
  detailsVersion: number;
  coveredOn: string | null;
  holdDays: number;
  holdReason: string | null;
  decidedById: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  selfApproved: boolean;
  approverIsMember: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  accessUntil: string | null;
  voidedById: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  bill: BillingBillView | null;
  bills: BillingBillView[];
  receipts: BillingReceiptView[];
  payments: BillingPaymentView[];
  events: BillingEventView[];
}

/** Where the organization stands. `kind` is `none`, `active`, `renewal_open`, `overdue`, `held` or `expired`. */
export interface BillingStandingView {
  kind: string;
  /** Days to the due date, days of access left, or days since expiry, by `kind`. */
  days: number | null;
  planKey: string | null;
  planLabel: string | null;
  planArchived: boolean;
  cancelled: boolean;
  trial: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  accessUntil: string | null;
  graceDays: number;
  holdDays: number;
  prepaid: boolean;
}

export interface BillingPlanOfferView {
  key: string;
  label: string;
  /** Centavos a month, or null when the plan has no price (Free). */
  monthly: number | null;
  isPublic: boolean;
  archived: boolean;
  current: boolean;
}

export interface BillingPaymentAccountView {
  method: string;
  label: string;
  details: string;
}

export interface BillingOverviewView {
  organizationId: string;
  /** Today in the billing time zone: what a payment's date picker calls today. */
  today: string;
  /** The billing time zone (IANA): every instant on the page is shown as its day there. */
  timeZone: string;
  currency: string;
  /** Centavos; negative is owed on the next bill. */
  creditBalance: number;
  standing: BillingStandingView;
  pending: BillingRequestView | null;
  plans: BillingPlanOfferView[];
  paymentAccounts: BillingPaymentAccountView[];
}

/** A cap the organization is over on a plan it chose (D6). */
export interface BillingOverrunView {
  limit: string;
  have: number;
  allowed: number;
  remove: number;
}

export interface BillingPreviewView {
  kind: string;
  planKey: string | null;
  allowed: boolean;
  refusal: string | null;
  message: string | null;
  nextStep: string | null;
  quote: {
    lines: BillingLineView[];
    total: number;
    creditUsed: number;
    creditAdded: number;
    direction: string | null;
    billAtSubmission: boolean;
    periodStart: string | null;
    periodEnd: string | null;
  } | null;
  overruns: BillingOverrunView[];
}

export interface BillingHistoryPageView {
  items: BillingRequestView[];
  nextCursor: string | null;
}

/** What an owner (or admin) says they paid. Amounts in centavos; `paidOn` a `YYYY-MM-DD` day. */
export interface BillingPaymentInput {
  method: string;
  amount: number;
  paidOn: string;
  reference?: string | null;
  sender?: string | null;
  note?: string | null;
}

/** The kinds an owner chooses a plan for (the owner's, D8). */
export type ChosenPlanKind = 'subscribe' | 'change_plan' | 'replace';

export interface BillingClient {
  overview(organizationId: string): Promise<BillingOverviewView>;
  preview(organizationId: string, kind: string, planKey: string | null): Promise<BillingPreviewView>;
  history(organizationId: string, cursor: string | null, limit?: number): Promise<BillingHistoryPageView>;
  requestPlan(organizationId: string, kind: ChosenPlanKind, planKey: string): Promise<BillingRequestView>;
  renew(organizationId: string): Promise<BillingRequestView>;
  cancel(organizationId: string): Promise<BillingRequestView>;
  enterPayment(organizationId: string, requestId: string, payment: BillingPaymentInput): Promise<BillingRequestView>;
  withdraw(organizationId: string, requestId: string, reason: string | null): Promise<BillingRequestView>;
}

/** The client over `fetch`, at `path` (the app's GraphQL route handler). */
export function createBillingClient(path = DEFAULT_GRAPHQL_PATH): BillingClient {
  /** One document POSTed to the route handler: its data, or its first error as the sentence to show. */
  async function graphql<T>(document: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ query: document, variables }),
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(response.status === 401 ? 'Your session has ended. Sign in again.' : 'Cannot reach the server.');
    }
    const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
    // A refusal's message is its sentence and next step (`PLATFORM_BILLING_REFUSALS`), shown as it comes.
    if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'The request was refused.');
    if (!body.data) throw new Error('The server returned no data.');
    return body.data;
  }
  const ops = PLATFORM_BILLING_OPERATIONS;

  return {
    /** The page in one read: standing, credit, the pending request, plans, where to pay. */
    async overview(organizationId) {
      return (await graphql<{ platformBillingOverview: BillingOverviewView }>(ops.overview, { organizationId }))
        .platformBillingOverview;
    },
    /** A request before it is made: its price today, or its refusal with the next step. */
    async preview(organizationId, kind, planKey) {
      return (
        await graphql<{ platformBillingPreview: BillingPreviewView }>(ops.preview, { organizationId, kind, planKey })
      ).platformBillingPreview;
    },
    /** One page of the history, newest first. */
    async history(organizationId, cursor, limit = 20) {
      return (
        await graphql<{ platformBillingHistory: BillingHistoryPageView }>(ops.history, {
          organizationId,
          cursor,
          limit,
        })
      ).platformBillingHistory;
    },
    /** Subscribe, change plan or replace an archived plan (the owner's). */
    async requestPlan(organizationId, kind, planKey) {
      return (
        await graphql<{ requestPlatformBillingPlan: BillingRequestView }>(ops.requestPlan, {
          organizationId,
          kind,
          planKey,
        })
      ).requestPlatformBillingPlan;
    },
    /** Another month of the current plan. */
    async renew(organizationId) {
      return (await graphql<{ renewPlatformBilling: BillingRequestView }>(ops.renew, { organizationId }))
        .renewPlatformBilling;
    },
    /** End at the close of the period (the owner's). */
    async cancel(organizationId) {
      return (await graphql<{ cancelPlatformBilling: BillingRequestView }>(ops.cancel, { organizationId }))
        .cancelPlatformBilling;
    },
    /** A new version of the pending request's payment details. */
    async enterPayment(organizationId, requestId, payment) {
      return (
        await graphql<{ enterPlatformBillingPayment: BillingRequestView }>(ops.enterPayment, {
          organizationId,
          requestId,
          payment,
        })
      ).enterPlatformBillingPayment;
    },
    /** Take the pending request back: its bill is cancelled. */
    async withdraw(organizationId, requestId, reason) {
      return (
        await graphql<{ withdrawPlatformBillingRequest: BillingRequestView }>(ops.withdraw, {
          organizationId,
          requestId,
          reason,
        })
      ).withdrawPlatformBillingRequest;
    },
  };
}
