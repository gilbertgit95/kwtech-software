import type { PlatformBillingTransaction } from './platform-billing.repository.js';

/**
 * WHAT BILLING ASKS THE APP (PLAN §9: a module never imports a module). Plans
 * and subscriptions are `module-permissions`' tables, and the app is the only
 * party that holds both.
 */

/** The live organization-wide subscription, as `perm_subscription` stores it. */
export interface BillingSubscriptionRow {
  subscriptionId: string;
  planKey: string;
  planArchived: boolean;
  periodStart: Date | null;
  currentPeriodEnd: Date | null;
  billingDay: number | null;
  accessUntil: Date | null;
  /**
   * A trial (D2): the days were free. Billing reads it as UNPAID, so the owner
   * subscribes (the trial row ends) rather than renewing a month nobody paid,
   * and a plan change never credits trial days back.
   */
  trial: boolean;
}

/** A period as billing writes it: instants at the start of platform days. */
export interface BillingPeriodWrite {
  organizationId: string;
  periodStart: Date;
  periodEnd: Date;
  billingDay: number;
  accessUntil: Date;
}

/**
 * The subscription, read and written INSIDE billing's transaction.
 *
 * ⚠ THE SHARED TRANSACTION (plan §3, the phase-4 spike). Every write takes the
 * `tx` billing is running in, and the app's adapter hands that same
 * transaction to `module-permissions`' write service, so an approval's
 * subscription, receipt, number and credit commit together or not at all. An
 * adapter that opened a transaction of its own would let a receipt stand for a
 * plan that never applied.
 */
export interface PlatformBillingSubscriptions {
  /**
   * Every live organization-wide row on `planKey`, with its organization:
   * whom an archive of the plan owes credit (D12b). Read inside `tx`, the
   * archive's own transaction.
   */
  liveOnPlan(
    planKey: string,
    tx: PlatformBillingTransaction,
  ): Promise<ReadonlyArray<BillingSubscriptionRow & { organizationId: string }>>;
  /** The live organization-wide row, or null (no row holds the organization's slot). */
  live(organizationId: string, tx?: PlatformBillingTransaction): Promise<BillingSubscriptionRow | null>;
  /** The same row, its period and access moved forward (a renewal before access ended). */
  renew(input: BillingPeriodWrite, tx: PlatformBillingTransaction): Promise<{ subscriptionId: string }>;
  /** The old row ended and a new one started on `planKey` (a plan change). */
  changePlan(
    input: BillingPeriodWrite & { planKey: string },
    tx: PlatformBillingTransaction,
  ): Promise<{ subscriptionId: string }>;
  /** A new row on `planKey`, ending any live one (a subscribe, a replacement, a renewal after expiry). */
  start(
    input: BillingPeriodWrite & { planKey: string },
    tx: PlatformBillingTransaction,
  ): Promise<{ subscriptionId: string }>;
  /**
   * The live row ended, no new one started: a void of a subscribe, a
   * replacement or a renewal after expiry. The organization falls back to
   * Free (`organization.fallback_plan`), as an expired one does.
   */
  end(input: { organizationId: string }, tx: PlatformBillingTransaction): Promise<{ subscriptionId: string }>;
  /** Only the access end moved: a hold given or taken back, a cancel, a cancel voided. */
  setAccessUntil(
    input: { organizationId: string; accessUntil: Date },
    tx: PlatformBillingTransaction,
  ): Promise<{ subscriptionId: string }>;
}

/**
 * A subscription written by hand on the admin screens, as permissions reports
 * it (D5). Copied structurally from `module-permissions`'
 * `SubscriptionAdjustment`, since modules never import each other (PLAN §9).
 */
export interface BillingAdjustment {
  actorId: string;
  organizationId: string;
  subscriptionId: string;
  action: 'start' | 'update' | 'end';
  planKey: string;
  reason: string;
  at: Date;
  /** The row just before the write (null for a start), and after it (an end keeps its row, canceled). */
  before: { status: string; currentPeriodEnd: Date | null; accessUntil: Date | null } | null;
  after: { status: string; currentPeriodEnd: Date | null; accessUntil: Date | null };
}

/** A plan as billing needs it: its listing, and its features and caps for D6. */
export interface BillingPlan {
  key: string;
  label: string;
  isPublic: boolean;
  archived: boolean;
  features: readonly string[];
  limits: Readonly<Record<string, number>>;
}

export interface PlatformBillingPlans {
  /** Every plan, archived ones included (a request may name one). */
  plans(): Promise<readonly BillingPlan[]>;
  /**
   * How much of each cap the organization uses now, by limit key, for the caps
   * the app can count. A cap missing here is not compared, so a downgrade is
   * never refused on a count nobody took (D6).
   */
  usage(organizationId: string): Promise<Readonly<Record<string, number>>>;
}

export interface PlatformBillingPeople {
  /** Whether `userId` is a member of `organizationId` (D15: flagged, never blocking). */
  isMember(userId: string, organizationId: string): Promise<boolean>;
}
