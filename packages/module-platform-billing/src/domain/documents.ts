import type { DayKey } from './days.js';
import type { Centavos } from './money.js';
import type { ReceiptMethod } from './payments.js';
import type { Period } from './periods.js';
import type { Quote, QuoteLine } from './quotes.js';
import type { RequestKind } from './requests.js';

/**
 * WHAT A BILL AND A RECEIPT SAY WHEN ISSUED (PLATFORM-BILLING-PLAN §7). Stored
 * as snapshots and never rewritten: a plan renamed, a price changed or an
 * issuer's address moved later leaves every issued document as it was.
 */

/** Who issues, as printed. */
export interface Issuer {
  name: string;
  details: string;
}

/** A bill as issued. */
export interface BillSnapshot {
  number: string;
  kind: RequestKind;
  organizationId: string;
  planKey: string;
  planLabel: string;
  fromPlanKey: string | null;
  fromPlanLabel: string | null;
  lines: readonly QuoteLine[];
  total: Centavos;
  creditUsed: Centavos;
  creditAdded: Centavos;
  owedCleared: Centavos;
  /** The monthly prices the lines were worked from. */
  monthly: Centavos;
  oldMonthly: Centavos | null;
  direction: 'upgrade' | 'downgrade' | null;
  /** The day it was priced for, and, for a change or renewal, the period it was priced against. */
  pricedOn: DayKey;
  pricedForPeriod: Period | null;
  currency: string;
  issuer: Issuer;
  issuedOn: DayKey;
}

/** A receipt as issued. Titled as an acknowledgement until PLAN §12.128 is settled. */
export interface ReceiptSnapshot {
  number: string;
  title: 'Acknowledgement receipt';
  /** ⚠ Printed on every receipt until official receipts are settled (PLAN §12.128). */
  notice: 'This is not an official receipt.';
  billNumber: string | null;
  /** `paid_from_credit`: an automatic renewal (#129), `amount` 0 and the credit spent on the bill's lines. */
  kind: 'payment' | 'closed_as_credit' | 'paid_from_credit';
  organizationId: string;
  planLabel: string;
  amount: Centavos;
  currency: string;
  method: ReceiptMethod;
  reference: string | null;
  paidOn: DayKey;
  /** The period the payment bought, when it bought one. */
  period: { start: DayKey; end: DayKey } | null;
  selfApproved: boolean;
  issuer: Issuer;
  issuedOn: DayKey;
}

/** The bill for a priced request. */
export function billSnapshot(input: {
  number: string;
  kind: RequestKind;
  organizationId: string;
  plan: { key: string; label: string };
  fromPlan: { key: string; label: string } | null;
  quote: Quote;
  monthly: Centavos;
  oldMonthly: Centavos | null;
  direction: 'upgrade' | 'downgrade' | null;
  pricedOn: DayKey;
  pricedForPeriod: Period | null;
  currency: string;
  issuer: Issuer;
  issuedOn: DayKey;
}): BillSnapshot {
  return {
    number: input.number,
    kind: input.kind,
    organizationId: input.organizationId,
    planKey: input.plan.key,
    planLabel: input.plan.label,
    fromPlanKey: input.fromPlan?.key ?? null,
    fromPlanLabel: input.fromPlan?.label ?? null,
    lines: input.quote.lines,
    total: input.quote.total,
    creditUsed: input.quote.creditUsed,
    creditAdded: input.quote.creditAdded,
    owedCleared: input.quote.owedCleared,
    monthly: input.monthly,
    oldMonthly: input.oldMonthly,
    direction: input.direction,
    pricedOn: input.pricedOn,
    pricedForPeriod: input.pricedForPeriod,
    currency: input.currency,
    issuer: input.issuer,
    issuedOn: input.issuedOn,
  };
}

/**
 * A stored bill snapshot read back. Written only by `billSnapshot` through
 * this module, so the shape is known; the checks are of the fields the
 * approval spends, so a row edited by hand fails loudly instead of approving
 * on a missing total.
 */
export function readBillSnapshot(value: unknown): BillSnapshot {
  if (typeof value !== 'object' || value === null) throw new Error('A bill has no snapshot.');
  const snapshot = value as BillSnapshot;
  for (const field of ['total', 'creditUsed', 'creditAdded', 'owedCleared', 'monthly'] as const) {
    if (!Number.isSafeInteger(snapshot[field])) throw new Error(`A bill's snapshot has no ${field}.`);
  }
  if (!Array.isArray(snapshot.lines)) throw new Error("A bill's snapshot has no lines.");
  return snapshot;
}
