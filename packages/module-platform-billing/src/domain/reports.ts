import { type DayKey, platformDay } from './days.js';

/**
 * THE PLATFORM'S REPORTS (PLATFORM-BILLING-PLAN §7, phase 7b): what was
 * collected over a range of days, by day, by month and by method, and what
 * each plan earned; and where every organization stands, counted. Built from
 * rows as pure data, so the numbers are tested without a database.
 *
 * ⚠ Collected means a receipt that stands: a voided receipt was never money
 * kept, whenever it was voided, exactly as the statement of account counts
 * it. A receipt is dated by the day it was ISSUED in the billing time zone
 * (the day the platform recorded the money), not the day the organization
 * said it paid, so a report for a closed month never changes after the fact.
 */

/** Money collected on one day by one method. */
export interface CollectedRow {
  /** A day (`YYYY-MM-DD`) or a month (`YYYY-MM`), by which list it is in. */
  period: string;
  method: string;
  /** Centavos. */
  amount: number;
  /** Receipts counted. */
  receipts: number;
}

/** What one plan earned in the range. */
export interface PlanRevenueRow {
  /** The plan, or null for payments kept as credit (D12a), which bought no plan. */
  planKey: string | null;
  planLabel: string;
  amount: number;
  receipts: number;
}

/** The collections report for a range of days. */
export interface CollectionsReport {
  from: DayKey;
  to: DayKey;
  currency: string;
  /** Centavos collected in the range, and by how many receipts. */
  total: number;
  receipts: number;
  byDay: CollectedRow[];
  byMonth: CollectedRow[];
  byMethod: CollectedRow[];
  perPlan: PlanRevenueRow[];
}

/** One receipt as the report reads it. */
export interface ReportReceipt {
  amount: number;
  method: string;
  kind: string;
  issuedAt: Date;
  voidedAt: Date | null;
  /** The request's plan: what the payment bought. */
  planKey: string | null;
}

/** The words for payments kept as credit in the per-plan list. */
export const KEPT_AS_CREDIT_LABEL = 'Kept as credit (no plan)';

/**
 * The collections report: every receipt that stands, summed by day, month,
 * method and plan. Rows are sorted (periods oldest first, then method;
 * plans by what they earned, most first) so a page and a CSV list them the
 * same way.
 */
export function buildCollectionsReport(input: {
  from: DayKey;
  to: DayKey;
  currency: string;
  timeZone: string;
  receipts: readonly ReportReceipt[];
  planLabels: ReadonlyMap<string, string>;
}): CollectionsReport {
  const byDay = new Map<string, CollectedRow>();
  const byMonth = new Map<string, CollectedRow>();
  const byMethod = new Map<string, CollectedRow>();
  const perPlan = new Map<string, PlanRevenueRow>();
  let total = 0;
  let receipts = 0;

  for (const receipt of input.receipts) {
    if (receipt.voidedAt) continue;
    // ⚠ No money came in (#129): the cash it spends was counted when its paid-ahead payment was.
    if (receipt.kind === 'paid_from_credit') continue;
    const day = platformDay(receipt.issuedAt, input.timeZone);
    // The range is the caller's query; a receipt outside it (a stale row, a zone edge) is never counted.
    if (day < input.from || day > input.to) continue;
    total += receipt.amount;
    receipts += 1;
    add(byDay, `${day}|${receipt.method}`, { period: day, method: receipt.method }, receipt.amount);
    add(
      byMonth,
      `${day.slice(0, 7)}|${receipt.method}`,
      { period: day.slice(0, 7), method: receipt.method },
      receipt.amount,
    );
    add(byMethod, receipt.method, { period: `${input.from}..${input.to}`, method: receipt.method }, receipt.amount);
    const planKey = receipt.kind === 'closed_as_credit' ? null : receipt.planKey;
    const plan = perPlan.get(planKey ?? '') ?? {
      planKey,
      planLabel: planKey === null ? KEPT_AS_CREDIT_LABEL : (input.planLabels.get(planKey) ?? planKey),
      amount: 0,
      receipts: 0,
    };
    perPlan.set(planKey ?? '', { ...plan, amount: plan.amount + receipt.amount, receipts: plan.receipts + 1 });
  }

  const byPeriod = (a: CollectedRow, b: CollectedRow) =>
    a.period.localeCompare(b.period) || a.method.localeCompare(b.method);
  return {
    from: input.from,
    to: input.to,
    currency: input.currency,
    total,
    receipts,
    byDay: [...byDay.values()].sort(byPeriod),
    byMonth: [...byMonth.values()].sort(byPeriod),
    byMethod: [...byMethod.values()].sort(byPeriod),
    perPlan: [...perPlan.values()].sort((a, b) => b.amount - a.amount || a.planLabel.localeCompare(b.planLabel)),
  };
}

/** Adds one receipt's amount to the row at `key`, starting it from `base`. */
function add(
  rows: Map<string, CollectedRow>,
  key: string,
  base: Pick<CollectedRow, 'period' | 'method'>,
  amount: number,
) {
  const row = rows.get(key) ?? { ...base, amount: 0, receipts: 0 };
  rows.set(key, { ...row, amount: row.amount + amount, receipts: row.receipts + 1 });
}

/** One organization as the standings summary reads it. */
export interface StandingEntry {
  /** The standing's kind (`active`, `renewal_open`, `overdue`, `held`, `expired`), or `none` without a paid plan. */
  kind: string;
  /** Centavos: positive is credit held, negative is owed (plan §4). */
  creditBalance: number;
  /** A request waits for a decision. */
  pending: boolean;
}

/** Every organization's standing, counted: what the reports page leads with. */
export interface StandingsSummary {
  organizations: number;
  /** How many stand in each kind, every kind present. */
  byKind: Record<string, number>;
  /** Overdue or held (access continues for now), and expired (access has ended). */
  overdue: number;
  expired: number;
  pending: number;
  /** Centavos of credit the platform holds for organizations, and owed to it, never netted. */
  creditHeld: number;
  creditOwed: number;
  organizationsWithCredit: number;
}

/**
 * The standings summary. Credit held and owed are kept apart: netting one
 * organization's credit against another's debt would describe nobody's
 * account.
 */
export function summariseStandings(entries: readonly StandingEntry[]): StandingsSummary {
  const byKind: Record<string, number> = {};
  let creditHeld = 0;
  let creditOwed = 0;
  let organizationsWithCredit = 0;
  let pending = 0;
  for (const entry of entries) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
    if (entry.creditBalance > 0) {
      creditHeld += entry.creditBalance;
      organizationsWithCredit += 1;
    }
    if (entry.creditBalance < 0) creditOwed += -entry.creditBalance;
    if (entry.pending) pending += 1;
  }
  return {
    organizations: entries.length,
    byKind,
    overdue: (byKind.overdue ?? 0) + (byKind.held ?? 0),
    expired: byKind.expired ?? 0,
    pending,
    creditHeld,
    creditOwed,
    organizationsWithCredit,
  };
}

/** The standing kinds a filter may name. Anything else is ignored. */
export const STANDING_FILTERS = ['attention', 'overdue', 'expired', 'credit', 'pending'] as const;

export type StandingFilter = (typeof STANDING_FILTERS)[number];

/** Whether `value` is a filter the organizations list takes. */
export function isStandingFilter(value: string): value is StandingFilter {
  return (STANDING_FILTERS as readonly string[]).includes(value);
}

/** Whether `entry` passes `filter`: `attention` is overdue, held or expired. */
export function matchesStanding(entry: StandingEntry, filter: StandingFilter | null): boolean {
  if (filter === null) return true;
  switch (filter) {
    case 'attention':
      return entry.kind === 'overdue' || entry.kind === 'held' || entry.kind === 'expired';
    case 'overdue':
      return entry.kind === 'overdue' || entry.kind === 'held';
    case 'expired':
      return entry.kind === 'expired';
    case 'credit':
      return entry.creditBalance !== 0;
    case 'pending':
      return entry.pending;
  }
}
