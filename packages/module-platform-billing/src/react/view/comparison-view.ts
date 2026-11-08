import { formatMoney } from './billing-view.js';

/**
 * THE PLAN COMPARISON'S WORDS (#101), as pure functions so they are tested
 * without rendering (the frontend rule: no React render tests).
 */

/** One plan of the comparison, as the client reads it. */
export interface ComparedPlanView {
  key: string;
  label: string;
  monthly: number | null;
  current: boolean;
  offered: boolean;
  features: readonly string[];
  limits: readonly { key: string; value: number | null }[];
}

export interface PlanComparisonView {
  currency: string;
  currentPlanKey: string | null;
  plans: readonly ComparedPlanView[];
  features: readonly { key: string; label: string; module: string }[];
  limits: readonly { key: string; label: string }[];
}

/** A cap in a cell: "No limit", or the number with thousands separators. */
export function capCell(value: number | null | undefined): string {
  if (value === undefined) return '—';
  return value === null ? 'No limit' : value.toLocaleString('en-US');
}

/** A price in a column head: "Free" for zero, "₱500.00 a month", or that it is not on sale. */
export function priceCell(plan: Pick<ComparedPlanView, 'monthly' | 'offered'>, currency: string): string {
  if (!plan.offered) return 'Not on offer';
  if (plan.monthly === null) return 'No price set';
  if (plan.monthly === 0) return 'Free';
  return `${formatMoney(plan.monthly, currency)} a month`;
}

/** The feature rows, grouped by module in the order they come (the registry's). */
export function featureGroups(
  comparison: Pick<PlanComparisonView, 'features'>,
): readonly { module: string; features: readonly { key: string; label: string }[] }[] {
  const groups: { module: string; features: { key: string; label: string }[] }[] = [];
  for (const feature of comparison.features) {
    const group = groups.find((one) => one.module === feature.module);
    if (group) group.features.push({ key: feature.key, label: feature.label });
    else groups.push({ module: feature.module, features: [{ key: feature.key, label: feature.label }] });
  }
  return groups;
}
