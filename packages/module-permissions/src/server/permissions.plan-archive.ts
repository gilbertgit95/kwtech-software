import type { PermissionsTransaction } from './permissions.repository.js';

/**
 * WHO ELSE MUST KNOW WHEN A PLAN IS ARCHIVED, inside the archive's own
 * transaction (PLATFORM-BILLING-PLAN D12b).
 *
 * Archiving cuts a plan's access at once, for every organization on it. The
 * organizations had paid for days they now lose, and some have requests
 * waiting that name the plan. Billing credits the first and closes the second
 * IN THE SAME TRANSACTION as the archive, so an archive never commits without
 * its credit, and a refusal (a payment still waiting on an approver) leaves
 * the plan as it was.
 *
 * A port and not an import, because modules never import each other (PLAN §9):
 * the app binds it (`apps/web-server/src/platform-billing/plan-archive.ts`).
 *
 * ⚠ UNBOUND means nobody is told: the archive happens exactly as it did before
 * billing existed. That is the right reading for an app without billing, and
 * the wrong one for an app with it, which is why the app binds it beside
 * billing's own providers.
 */
export interface PermissionsPlanArchiveHook {
  /**
   * `planKey` was archived (`archived: true`) or brought back. Runs inside
   * `tx`, the archive's transaction; throwing refuses the archive and rolls
   * it back, with the thrown error's message as the reason.
   */
  planArchiveChanged(
    input: { planKey: string; archived: boolean; at: Date },
    tx: PermissionsTransaction,
  ): Promise<void>;
}

export const PERMISSIONS_PLAN_ARCHIVE_HOOK = 'kwtech:permissions-plan-archive-hook';
