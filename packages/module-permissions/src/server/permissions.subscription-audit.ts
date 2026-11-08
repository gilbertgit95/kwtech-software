import type { PermissionsTransaction } from './permissions.repository.js';

/**
 * A subscription written by hand on the admin screens, as the audit hears of
 * it (PLATFORM-BILLING-PLAN D5): an ADJUSTMENT, with no payment behind it.
 */
export interface SubscriptionAdjustment {
  /** Who made it, proven by the guard (`billing:manage`). */
  actorId: string;
  organizationId: string;
  /** The row written: the new one for a `start`, the changed or ended one otherwise. */
  subscriptionId: string;
  action: 'start' | 'update' | 'end';
  planKey: string;
  /** The admin's own words, required and trimmed. */
  reason: string;
  at: Date;
  /** The row as it is after the write; null for an `end`. */
  after: { status: string; currentPeriodEnd: Date | null; accessUntil: Date | null } | null;
}

/**
 * ⚠ NOTHING WRITES A SUBSCRIPTION WITHOUT A BILLING RECORD (D5).
 *
 * Billing's own writes are approvals with a receipt; the admin screens'
 * `startSubscription`, `updateSubscription` and `endSubscription` are the
 * other way a plan reaches an organization. Each calls this INSIDE its
 * transaction, after the row is written, so the record and the row commit
 * together, and a failure here rolls the write back. A port and not an
 * import (PLAN §9): the app binds it to billing
 * (`apps/web-server/src/platform-billing/subscription-audit.ts`).
 *
 * UNBOUND means only the row is kept: the reason is still required, but
 * nobody stores it. That is right for an app without billing.
 */
export interface PermissionsSubscriptionAudit {
  subscriptionAdjusted(input: SubscriptionAdjustment, tx: PermissionsTransaction): Promise<void>;
}

export const PERMISSIONS_SUBSCRIPTION_AUDIT = 'kwtech:permissions-subscription-audit';
