import type { DayKey } from './days.js';
import type { Centavos } from './money.js';
import { type PriceRow, priceOn } from './standing.js';

/**
 * THE PLANS SIDE BY SIDE (#101), built from the same plan rows the caps and
 * features are enforced from, so the page and the enforcement cannot disagree.
 */

/** A plan as the comparison reads it: the permissions rows, through the PLANS port. */
export interface ComparedPlanInput {
  key: string;
  label: string;
  isPublic: boolean;
  archived: boolean;
  features: readonly string[];
  limits: Readonly<Record<string, number>>;
}

/** What a feature or a cap is called on screen (the code registries, through the PLANS port). */
export interface CatalogueLabels {
  features: readonly { key: string; label: string; module: string }[];
  /**
   * `defaultValue` is what a plan that sets no number gets (null = no limit),
   * as permissions resolves it. `module` is the app the cap counts in: a plan
   * that includes none of that app's features has no use for the cap (#183).
   */
  limits: readonly {
    key: string;
    label: string;
    module: string;
    source: 'plan' | 'role';
    defaultValue: number | null;
  }[];
}

export interface ComparedPlan {
  key: string;
  label: string;
  /** Today's monthly price; null when none is set (the plan cannot be requested). */
  monthly: Centavos | null;
  current: boolean;
  /** Only the current plan can be listed while not public or archived (a Custom plan, an old one). */
  offered: boolean;
  features: readonly string[];
  /** Every plan-sourced cap, by key: the plan's number, the declared default when it sets none, null = no limit. */
  limits: Readonly<Record<string, number | null>>;
  /**
   * The caps of apps this plan does not include (#183), by key. Their number
   * means nothing to somebody on the plan, and printing the declared default
   * made Free read as allowing ten queue windows when it has no queue at all.
   */
  notIncluded: readonly string[];
}

export interface PlanComparison {
  currentPlanKey: string | null;
  plans: readonly ComparedPlan[];
  /** The features some listed plan includes, grouped by module in registry order. */
  features: readonly { key: string; label: string; module: string }[];
  /** The plan-sourced caps. A role's cap is not bought, so it is not compared. */
  limits: readonly { key: string; label: string }[];
}

/**
 * Whether a plan holding `planFeatures` includes the app `module`: any one of
 * its features. A module that declares no features at all (the organization's
 * own caps, from permissions) counts as included, since there is nothing a
 * plan could leave out.
 */
function includesApp(planFeatures: readonly string[], module: string, features: CatalogueLabels['features']): boolean {
  const own = features.filter((feature) => feature.module === module);
  return own.length === 0 || own.some((feature) => planFeatures.includes(feature.key));
}

/**
 * Public, unarchived plans, plus the organization's own plan whatever it is,
 * cheapest first (a plan with no price after every priced one, then by label).
 */
export function buildPlanComparison(input: {
  plans: readonly ComparedPlanInput[];
  prices: readonly PriceRow[];
  today: DayKey;
  currentPlanKey: string | null;
  labels: CatalogueLabels;
}): PlanComparison {
  const { plans, prices, today, currentPlanKey, labels } = input;
  const caps = labels.limits.filter((limit) => limit.source === 'plan');
  const listed = plans
    .filter((plan) => plan.key === currentPlanKey || (plan.isPublic && !plan.archived))
    .map(
      (plan): ComparedPlan => ({
        key: plan.key,
        label: plan.label,
        monthly: priceOn(prices, plan.key, today),
        current: plan.key === currentPlanKey,
        offered: plan.isPublic && !plan.archived,
        features: [...plan.features],
        limits: Object.fromEntries(caps.map((cap) => [cap.key, plan.limits[cap.key] ?? cap.defaultValue])),
        notIncluded: caps
          .filter((cap) => !includesApp(plan.features, cap.module, labels.features))
          .map((cap) => cap.key),
      }),
    )
    .sort((a, b) => {
      if (a.monthly !== b.monthly) return a.monthly === null ? 1 : b.monthly === null ? -1 : a.monthly - b.monthly;
      return a.label.localeCompare(b.label);
    });
  const included = new Set(listed.flatMap((plan) => plan.features));
  return {
    currentPlanKey,
    plans: listed,
    features: labels.features.filter((feature) => included.has(feature.key)),
    limits: caps.map((cap) => ({ key: cap.key, label: cap.label })),
  };
}

/**
 * "Point of sale is in Basic and Pro. You are on Free." (#101): what a feature
 * the plan lacks is in, for `not_entitled`. Only plans on offer are named; a
 * feature in none of them says to contact us.
 */
export function notEntitledText(comparison: PlanComparison, featureKey: string): string {
  const feature = comparison.features.find((one) => one.key === featureKey);
  const name = feature?.label ?? 'This';
  const holders = comparison.plans.filter((plan) => plan.offered && plan.features.includes(featureKey));
  const current = comparison.plans.find((plan) => plan.current);
  const on = current ? ` You are on ${current.label}.` : ' Your organization has no paid plan.';
  if (holders.length === 0) return `${name} is not in any plan on offer. Contact us for a Custom plan.`;
  return `${name} is in ${joinNames(holders.map((plan) => plan.label))}.${on}`;
}

/** "Basic", "Basic and Pro", "Basic, Pro and Max". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
