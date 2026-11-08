import type { LimitRaise } from '@kwtech/module-kit';
import type { LimitSpec } from './limits.js';

/** A plan as the cap advice reads it: its own number for each key it sets. */
export interface PlanCapOffer {
  key: string;
  label: string;
  isPublic: boolean;
  archived: boolean;
  limits: Readonly<Record<string, number>>;
}

/** A plan's cap for a key: its own number, or the declared default when it sets none (as `resolveLimits`). */
function capOf(plan: PlanCapOffer, spec: LimitSpec): number | null {
  return plan.limits[spec.key] ?? spec.defaultValue;
}

/** Null (no limit) is above every number. */
function above(candidate: number | null, cap: number): boolean {
  return candidate === null || candidate > cap;
}

/**
 * WHICH PLAN SET A REFUSED CAP, AND WHICH ONE RAISES IT (#101).
 *
 * - **The plan**: the organization's plan whose number IS the cap (the
 *   largest wins in `resolveLimits`, so that is the one that set it); null when
 *   it has no plan.
 * - **The next**: the smallest PUBLIC, unarchived plan with a higher cap, never
 *   one it already has. Archived and non-public plans (Custom) are never
 *   offered: nobody can choose them. Ties go by label, so the answer is stable.
 *
 * Only for a plan-sourced cap: a role's cap is granted, not bought, and no
 * plan raises it (undefined, so the refusal says only the number).
 */
export function limitRaise(input: {
  spec: LimitSpec;
  cap: number;
  planKeys: readonly string[];
  catalogue: readonly PlanCapOffer[];
}): LimitRaise | undefined {
  const { spec, cap, planKeys, catalogue } = input;
  if (spec.source !== 'plan') return undefined;
  const held = new Set(planKeys);
  const current = catalogue.find((plan) => held.has(plan.key) && capOf(plan, spec) === cap) ?? null;
  const next =
    catalogue
      .filter((plan) => plan.isPublic && !plan.archived && !held.has(plan.key) && above(capOf(plan, spec), cap))
      .sort((a, b) => {
        const ca = capOf(a, spec);
        const cb = capOf(b, spec);
        if (ca !== cb) return ca === null ? 1 : cb === null ? -1 : ca - cb;
        return a.label.localeCompare(b.label);
      })[0] ?? null;
  return {
    plan: current ? { key: current.key, label: current.label } : null,
    next: next ? { key: next.key, label: next.label, limit: capOf(next, spec) } : null,
  };
}
