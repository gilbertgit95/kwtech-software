'use client';

import { PLATFORM_BILLING_OPERATIONS } from '../operations.js';
import { type BillingRequestView, type BillingStandingView, DEFAULT_GRAPHQL_PATH } from './billing-client.js';

/**
 * THE PLATFORM'S BILLING CLIENT (phase 7): the queue, the decisions, the
 * settings and the prices, every one an app-level key (`queue_read`,
 * `approve`, `void`, `manage_settings`). Apart from the organization's client
 * because no organization page sends these, and none of these needs one.
 */

/** The checks an approver reads on a request: they flag, never decide (plan §4). */
export interface BillingQueueFlagsView {
  /** Other requests whose payment carries the same reference. */
  referenceUsedOn: string[];
  /** The latest details against the bill: `exact`, `short`, `over`, or `none`. */
  amount: string;
  amountDifference: number;
  missingDetails: boolean;
  holdInForce: boolean;
  selfRequest: boolean;
  viewerIsMember: boolean;
}

export interface BillingQueueItemView {
  request: BillingRequestView;
  organizationName: string | null;
  flags: BillingQueueFlagsView;
}

export interface BillingQueuePageView {
  items: BillingQueueItemView[];
  nextCursor: string | null;
}

export interface BillingSettingsView {
  currency: string;
  timeZone: string;
  graceDays: number;
  issuerName: string;
  issuerDetails: string;
  paymentAccounts: Array<{ method: string; label: string; details: string }>;
  /** A bill exists: the currency and the time zone can no longer change (D16). */
  locked: boolean;
}

/** A settings change: an absent field is left as it is. */
export interface BillingSettingsInput {
  currency?: string;
  timeZone?: string;
  graceDays?: number;
  issuerName?: string;
  issuerDetails?: string;
  paymentAccounts?: Array<{ method: string; label: string; details: string }>;
}

export interface BillingPriceRowView {
  planKey: string;
  monthly: number;
  effectiveFrom: string;
}

export interface BillingPlanEntryView {
  key: string;
  label: string;
  isPublic: boolean;
  archived: boolean;
  /** Today's monthly price in centavos, or null when none is set. */
  monthly: number | null;
}

/** One organization's standing on the platform's list (phase 7b). */
export interface BillingOrganizationStandingView {
  organizationId: string;
  name: string;
  standing: BillingStandingView;
  /** Centavos: positive is credit held, negative is owed. */
  creditBalance: number;
  pendingRequestId: string | null;
}

export interface BillingOrganizationPageView {
  items: BillingOrganizationStandingView[];
  nextCursor: string | null;
  /** False when the app does not list organizations to billing. */
  available: boolean;
}

/** Money collected in one period (a day or a month) by one method. */
export interface BillingCollectedView {
  period: string;
  method: string;
  amount: number;
  receipts: number;
}

export interface BillingReportView {
  from: string;
  to: string;
  currency: string;
  total: number;
  receipts: number;
  byDay: BillingCollectedView[];
  byMonth: BillingCollectedView[];
  byMethod: BillingCollectedView[];
  perPlan: Array<{ planKey: string | null; planLabel: string; amount: number; receipts: number }>;
  standings: {
    organizations: number;
    byKind: Array<{ kind: string; count: number }>;
    overdue: number;
    expired: number;
    pending: number;
    creditHeld: number;
    creditOwed: number;
    organizationsWithCredit: number;
    complete: boolean;
    available: boolean;
  };
}

/** What an approver confirms: the details version they reviewed, and the payment as received. */
export interface BillingApprovalInput {
  detailsVersion: number;
  method: string;
  amount: number;
  paidOn: string;
  reference?: string | null;
}

export interface BillingAdminClient {
  queue(cursor: string | null): Promise<BillingQueuePageView>;
  decided(cursor: string | null): Promise<BillingQueuePageView>;
  review(requestId: string): Promise<BillingQueueItemView | null>;
  approve(requestId: string, approval: BillingApprovalInput): Promise<BillingRequestView>;
  reject(requestId: string, reason: string): Promise<BillingRequestView>;
  closeAsCredit(requestId: string, payment: BillingApprovalInput, reason: string | null): Promise<BillingRequestView>;
  void(requestId: string, reason: string): Promise<BillingRequestView>;
  settings(): Promise<BillingSettingsView>;
  setSettings(settings: BillingSettingsInput): Promise<BillingSettingsView>;
  prices(): Promise<BillingPriceRowView[]>;
  planList(): Promise<BillingPlanEntryView[]>;
  setPrice(planKey: string, monthly: number, effectiveFrom: string): Promise<BillingPriceRowView[]>;
  organizations(cursor: string | null, filter: string | null): Promise<BillingOrganizationPageView>;
  report(from: string, to: string): Promise<BillingReportView>;
}

/**
 * How long one call may take, request and body together, in milliseconds.
 * A page stays busy until its re-read lands, so a call that never answers
 * would leave its forms disabled for good; past this it fails with a
 * sentence the page shows beside Reload.
 */
export const BILLING_ADMIN_TIMEOUT_MS = 20_000;

/** The platform's client over `fetch`, at `path` (the app's GraphQL route handler). */
export function createBillingAdminClient(path = DEFAULT_GRAPHQL_PATH): BillingAdminClient {
  /** One document POSTed: its data, or its first error as the sentence to show. */
  async function graphql<T>(document: string, variables: Record<string, unknown>): Promise<T> {
    // One deadline for the request and its body: a stalled body would hang as surely as a stalled request.
    const signal = AbortSignal.timeout(BILLING_ADMIN_TIMEOUT_MS);
    let body: { data?: T; errors?: { message: string }[] };
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ query: document, variables }),
        cache: 'no-store',
        signal,
      });
      if (!response.ok) {
        throw new Error(
          response.status === 401 ? 'Your session has ended. Sign in again.' : 'Cannot reach the server.',
        );
      }
      body = (await response.json()) as typeof body;
    } catch (cause) {
      if (signal.aborted) throw new Error('The server took too long to answer. Try again.');
      // fetch rejects with a TypeError when the network fails; our own refusals above pass through as they are.
      if (cause instanceof TypeError) throw new Error('Cannot reach the server.');
      throw cause;
    }
    if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'The request was refused.');
    if (!body.data) throw new Error('The server returned no data.');
    return body.data;
  }
  const ops = PLATFORM_BILLING_OPERATIONS;

  return {
    /** Waiting requests, oldest first. */
    async queue(cursor) {
      return (await graphql<{ platformBillingQueue: BillingQueuePageView }>(ops.queue, { cursor, limit: 50 }))
        .platformBillingQueue;
    },
    /** Decided requests, newest first. */
    async decided(cursor) {
      return (await graphql<{ platformBillingDecided: BillingQueuePageView }>(ops.decided, { cursor, limit: 50 }))
        .platformBillingDecided;
    },
    /** One request, any organization's. */
    async review(requestId) {
      return (await graphql<{ platformBillingReview: BillingQueueItemView | null }>(ops.review, { requestId }))
        .platformBillingReview;
    },
    /** "We were paid": the plan applied, a receipt issued. */
    async approve(requestId, approval) {
      return (
        await graphql<{ approvePlatformBillingRequest: BillingRequestView }>(ops.approve, { requestId, approval })
      ).approvePlatformBillingRequest;
    },
    /** Rejected, with the reason the organization reads. */
    async reject(requestId, reason) {
      return (await graphql<{ rejectPlatformBillingRequest: BillingRequestView }>(ops.reject, { requestId, reason }))
        .rejectPlatformBillingRequest;
    },
    /** The payment kept as credit, the plan unchanged (D12a). */
    async closeAsCredit(requestId, payment, reason) {
      return (
        await graphql<{ closePlatformBillingRequestAsCredit: BillingRequestView }>(ops.closeAsCredit, {
          requestId,
          payment,
          reason,
        })
      ).closePlatformBillingRequestAsCredit;
    },
    /** An approval reversed, with the reason (D9a). */
    async void(requestId, reason) {
      return (await graphql<{ voidPlatformBillingRequest: BillingRequestView }>(ops.void, { requestId, reason }))
        .voidPlatformBillingRequest;
    },
    /** The settings in force. */
    async settings() {
      return (await graphql<{ platformBillingSettings: BillingSettingsView }>(ops.settings, {}))
        .platformBillingSettings;
    },
    /** A settings change; the currency and time zone refuse once billed. */
    async setSettings(settings) {
      return (await graphql<{ setPlatformBillingSettings: BillingSettingsView }>(ops.setSettings, { settings }))
        .setPlatformBillingSettings;
    },
    /** Every price row, by plan and day. */
    async prices() {
      return (await graphql<{ platformBillingPrices: BillingPriceRowView[] }>(ops.prices, {})).platformBillingPrices;
    },
    /** Every plan with today's price. */
    async planList() {
      return (await graphql<{ platformBillingPlanList: BillingPlanEntryView[] }>(ops.planList, {}))
        .platformBillingPlanList;
    },
    /** A plan's monthly price from a day on. */
    async setPrice(planKey, monthly, effectiveFrom) {
      return (
        await graphql<{ setPlatformBillingPrice: BillingPriceRowView[] }>(ops.setPrice, {
          planKey,
          monthly,
          effectiveFrom,
        })
      ).setPlatformBillingPrice;
    },
    /** Every organization's standing, by id, optionally filtered. */
    async organizations(cursor, filter) {
      return (
        await graphql<{ platformBillingOrganizations: BillingOrganizationPageView }>(ops.organizations, {
          cursor,
          limit: 50,
          filter,
        })
      ).platformBillingOrganizations;
    },
    /** The report for a range of days, with the standings counted. */
    async report(from, to) {
      return (await graphql<{ platformBillingReport: BillingReportView }>(ops.report, { from, to }))
        .platformBillingReport;
    },
  };
}
