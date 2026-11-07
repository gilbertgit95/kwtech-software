/**
 * WHICH SUBSCRIPTIONS ENTITLE NOW, AND WHETHER THE PAID ONE ENDED (#92,
 * PLATFORM-BILLING-PLAN D14).
 *
 * A live row (`active`, plan not archived) entitles until its `accessUntil`:
 * period end + grace + any hold, written by whoever wrote the period. Compared
 * here, on every context, so access never depends on a daily job having run —
 * a server down at the job's hour, or a failed run, cannot leave an
 * organization entitled for free.
 *
 * The rows past `accessUntil` are not thrown away: the latest organization-wide
 * one is what lets a refusal say "your plan ended on <date>" instead of "not in
 * your plan". Both questions are answered from ONE read, partitioned here,
 * because a second query for the expired rows would be a second account of the
 * same table that could disagree with the first.
 */

/** What this needs of a subscription row. */
export interface SubscriptionAccessRow {
  workspaceId: string | null;
  accessUntil: Date | null;
}

/** The partition, and what follows from it. */
export interface SubscriptionAccess<T extends SubscriptionAccessRow> {
  /** Rows that entitle now: no `accessUntil`, or one still ahead. */
  entitling: readonly T[];
  /**
   * No organization-wide row entitles: the organization falls back to the
   * platform's fallback plan (Free, `organization.fallback_plan`), if one is set.
   */
  needsFallback: boolean;
  /**
   * When the latest organization-wide row's access ended, as an ISO instant,
   * if one did and nothing organization-wide replaced it. Null otherwise —
   * including for an organization that never had a paid plan, which is
   * `not_entitled`, not expired.
   */
  endedAt: string | null;
}

/** Splits `rows` at `now`. `accessUntil` is excluded: the first instant without access. */
export function partitionSubscriptions<T extends SubscriptionAccessRow>(
  rows: readonly T[],
  now: Date,
): SubscriptionAccess<T> {
  const entitling = rows.filter((row) => row.accessUntil === null || row.accessUntil.getTime() > now.getTime());
  const needsFallback = !entitling.some((row) => row.workspaceId === null);
  if (!needsFallback) return { entitling, needsFallback, endedAt: null };
  let latest: Date | null = null;
  for (const row of rows) {
    if (row.workspaceId !== null || row.accessUntil === null) continue;
    if (row.accessUntil.getTime() > now.getTime()) continue;
    if (!latest || row.accessUntil.getTime() > latest.getTime()) latest = row.accessUntil;
  }
  return { entitling, needsFallback, endedAt: latest ? latest.toISOString() : null };
}

/**
 * Grace days given to a period end written OUTSIDE billing: the admin screens
 * and the new-organization default. The same 7 billing uses by default
 * (`DEFAULT_GRACE_DAYS` in module-platform-billing), restated here because a
 * module never imports a module; billing's own writes pass their own
 * `accessUntil` (the setting a super admin changes, plus any hold). Phase 4
 * turns the admin writes into billing adjustments (D5), and this goes with them.
 */
export const UNBILLED_GRACE_DAYS = 7;

/** `accessUntil` for a period end written outside billing: the end plus the grace, or null for no end. */
export function unbilledAccessUntil(periodEnd: Date | null): Date | null {
  if (!periodEnd) return null;
  return new Date(periodEnd.getTime() + UNBILLED_GRACE_DAYS * 86_400_000);
}
