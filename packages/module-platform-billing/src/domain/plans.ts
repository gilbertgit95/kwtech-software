/**
 * PLANS AS BILLING COMPARES THEM. A plan's features and caps belong to
 * `module-permissions`; billing receives them as plain data through the app
 * (a module never imports a module, §9) and asks two questions of them.
 */

/** A plan as billing sees it: its keys and its caps, copied structurally from `module-permissions`. */
export interface PlanShape {
  key: string;
  features: readonly string[];
  limits: Readonly<Record<string, number>>;
}

/**
 * Whether `a` covers `b`: every feature of `b`, and every cap of `b` at least
 * as large. A cap `a` does not set falls to the floor of 1 (module-permissions),
 * so it covers only a cap of 1 or less.
 */
export function planCovers(a: PlanShape, b: PlanShape): boolean {
  const features = new Set(a.features);
  if (!b.features.every((key) => features.has(key))) return false;
  return Object.entries(b.limits).every(([limit, value]) => (a.limits[limit] ?? 1) >= value);
}

/**
 * The plan among `plans` that covers every other, or null when none does — the
 * fold of workspace subscriptions (D3). Plans are not always nested, so null is
 * a real answer: the migration then stops for that organization rather than
 * guess, and an operator makes the union.
 */
export function pickCoveringPlan<T extends PlanShape>(plans: readonly T[]): T | null {
  return plans.find((candidate) => plans.every((other) => planCovers(candidate, other))) ?? null;
}

/** A cap an organization is over on a smaller plan, with how many to remove. */
export interface CapOverrun {
  limit: string;
  have: number;
  allowed: number;
  remove: number;
}

/** An overrun with the limit's name on screen ("Organization members"), for the refusal's lines (#190). */
export interface LabelledCapOverrun extends CapOverrun {
  label: string;
}

/**
 * Names each overrun by its limit's label from the composed registries, the
 * key only when none is known (a limit no mounted module declares). The key
 * on screen read "organization:members: the plan allows 3…" (#190).
 */
export function labelOverruns(
  overruns: readonly CapOverrun[],
  limits: readonly { key: string; label: string }[],
): LabelledCapOverrun[] {
  const labels = new Map(limits.map((limit) => [limit.key, limit.label]));
  return overruns.map((overrun) => ({ ...overrun, label: labels.get(overrun.limit) ?? overrun.limit }));
}

/**
 * The caps `usage` is over on `plan`: what refuses a downgrade (D6), with the
 * counts the refusal names ("Basic allows 3 members and you have 5. Remove 2").
 * Only the caps the organization has a count for are compared.
 */
export function capsBlockingDowngrade(
  usage: Readonly<Record<string, number>>,
  plan: Pick<PlanShape, 'limits'>,
): readonly CapOverrun[] {
  const overruns: CapOverrun[] = [];
  for (const [limit, have] of Object.entries(usage)) {
    const allowed = plan.limits[limit] ?? 1;
    if (have > allowed) overruns.push({ limit, have, allowed, remove: have - allowed });
  }
  return overruns;
}
