import { type DayKey, isDayKey } from './days.js';
import type { PlatformBillingRefusal } from './refusals.js';

/**
 * WHAT A VOID DOES TO THE SUBSCRIPTION (PLATFORM-BILLING-PLAN §4, D9a). An
 * approval records how it wrote the subscription and what the live row was
 * just before; a void reverses exactly that, never a guess made later from
 * settings, prices or plans that may all have moved since.
 */

/** How an approval wrote the subscription. */
export type AppliedHow =
  /** The same row moved on a period (a renewal before access ended). */
  | 'renew'
  /** The row ended and another plan started on the same period (a plan change). */
  | 'change'
  /** A new row from approval (a subscribe, a replacement, a renewal after expiry). */
  | 'start'
  /** Only the access end moved, to the period's end (a cancel). */
  | 'cancel';

export const APPLIED_HOWS: readonly AppliedHow[] = ['renew', 'change', 'start', 'cancel'];

/** The live row just before an approval, as the request stores it (`subscriptionBefore`). */
export interface SubscriptionBefore {
  subscriptionId: string;
  planKey: string;
  /** The row's period as platform days (derived when the row predates billing), or null when it had none. */
  periodStart: DayKey | null;
  periodEnd: DayKey | null;
  billingDay: number | null;
  /** The instant access ended, ISO, exactly as the row held it (a hold included), or null for none. */
  accessUntil: string | null;
}

/** What a void writes to the subscription. */
export type VoidPlan =
  /** Put the same row back on its previous period and access end. */
  | {
      kind: 'restore_period';
      period: { start: DayKey; end: DayKey; billingDay: number };
      accessUntil: string;
    }
  /** End the changed-to row and start the previous plan again, on the previous period. */
  | {
      kind: 'restore_plan';
      planKey: string;
      period: { start: DayKey; end: DayKey; billingDay: number };
      accessUntil: string;
    }
  /** End the row the approval started: the organization falls back to Free (`organization.fallback_plan`). */
  | { kind: 'end' }
  /** Only the access end goes back (the cancel is undone). */
  | { kind: 'restore_access'; accessUntil: string };

/**
 * The subscription write that reverses an approval, or the refusal.
 *
 * - `renew`: the row goes back to the period and access it had. Nothing is
 *   ended: the organization paid the period before, only not this one.
 * - `change`: the previous plan back for the rest of the period (plan §4). If
 *   that plan has since been archived it entitles nothing and cannot be
 *   started, so the row is ended instead and the organization falls back to
 *   Free; its paid days on the archived plan were credited at the archive.
 * - `start`: the row ends. Whatever was live before (Free's default row, an
 *   expired period, an archived plan) gave no paid access worth putting back.
 * - `cancel`: the access end goes back to what it was.
 *
 * An approval that did not record what it replaced (one approved before the
 * void existed) is refused: reversing it from today's settings would guess.
 */
export function planVoid(
  applied: AppliedHow | null,
  before: SubscriptionBefore | null,
  previousPlanUsable: boolean,
): VoidPlan | { refused: PlatformBillingRefusal } {
  switch (applied) {
    case 'start':
      return { kind: 'end' };
    case 'renew':
    case 'change': {
      const period = before ? periodOf(before) : null;
      if (!before || !period || !before.accessUntil) return { refused: 'subscription_changed' };
      if (applied === 'renew') return { kind: 'restore_period', period, accessUntil: before.accessUntil };
      if (!previousPlanUsable) return { kind: 'end' };
      return { kind: 'restore_plan', planKey: before.planKey, period, accessUntil: before.accessUntil };
    }
    case 'cancel':
      return before?.accessUntil
        ? { kind: 'restore_access', accessUntil: before.accessUntil }
        : { refused: 'subscription_changed' };
    case null:
      return { refused: 'subscription_changed' };
  }
}

function periodOf(before: SubscriptionBefore): { start: DayKey; end: DayKey; billingDay: number } | null {
  if (!before.periodStart || !before.periodEnd || before.billingDay === null) return null;
  return { start: before.periodStart, end: before.periodEnd, billingDay: before.billingDay };
}

/** The stored `applied` column read back; anything else is null (refused by `planVoid`). */
export function readAppliedHow(value: string | null): AppliedHow | null {
  return value !== null && (APPLIED_HOWS as readonly string[]).includes(value) ? (value as AppliedHow) : null;
}

/**
 * The stored `subscriptionBefore` read back. Written only by this module, so
 * the shape is known; a malformed value reads as null, which `planVoid`
 * refuses rather than reversing on half a record.
 */
export function readSubscriptionBefore(value: unknown): SubscriptionBefore | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const day = (field: unknown) => (typeof field === 'string' && isDayKey(field) ? field : null);
  if (typeof row.subscriptionId !== 'string' || typeof row.planKey !== 'string') return null;
  const accessUntil =
    typeof row.accessUntil === 'string' && !Number.isNaN(Date.parse(row.accessUntil)) ? row.accessUntil : null;
  return {
    subscriptionId: row.subscriptionId,
    planKey: row.planKey,
    periodStart: day(row.periodStart),
    periodEnd: day(row.periodEnd),
    billingDay: typeof row.billingDay === 'number' && Number.isInteger(row.billingDay) ? row.billingDay : null,
    accessUntil,
  };
}
