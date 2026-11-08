import type { PermissionsPlanArchiveHook, PermissionsTransaction } from '@kwtech/module-permissions/server';
import type { PlatformBillingTransaction } from '@kwtech/module-platform-billing/server';
import { PlatformBillingWriteService } from '@kwtech/module-platform-billing/server';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

/**
 * ⚠ PERMISSIONS' ARCHIVE TRANSACTION, HANDED TO BILLING (#112, D12b): the
 * mirror of `sharedTransaction` in ./subscriptions.ts.
 *
 * The archive runs in `PermissionsWriteService`'s interactive transaction,
 * which is Prisma's own transaction client and carries every delegate, the
 * `platformBilling*` ones included. Checked, not assumed: a transaction
 * without billing's delegates throws here, naming the fix, rather than billing
 * writing its credit outside the archive and an archive committing without it.
 */
export function billingTransaction(tx: PermissionsTransaction): PlatformBillingTransaction {
  const candidate = tx as unknown as Partial<Record<string, unknown>>;
  for (const delegate of ['platformBillingRequest', 'platformBillingCredit', 'platformBillingLock'] as const) {
    const value = candidate[delegate];
    if (typeof value !== 'object' || value === null) {
      throw new Error(
        `The archive's transaction has no ${delegate}, so billing cannot credit inside it. ` +
          "Bind PERMISSIONS_PRISMA_WRITE with the app's PrismaService (prisma/module-clients.ts).",
      );
    }
  }
  // The single cast: the runtime object is Prisma's transaction client, checked above.
  return tx as unknown as PlatformBillingTransaction;
}

/**
 * Tells billing when a plan is archived or brought back, inside the archive's
 * transaction: billing closes the pending requests that name the plan and
 * credits the paid days its organizations lose (`planArchiveChanged`).
 *
 * ⚠ BILLING'S SERVICE IS LOOKED UP WHEN AN ARCHIVE HAPPENS, not injected.
 * Billing's subscriptions adapter already injects `PermissionsWriteService`;
 * injecting billing's write service back into permissions' would be a cycle
 * Nest cannot construct. `ModuleRef` with `strict: false` finds it across
 * modules at call time, after both are built.
 */
@Injectable()
export class PlanArchiveToBilling implements PermissionsPlanArchiveHook {
  constructor(private readonly moduleRef: ModuleRef) {}

  async planArchiveChanged(input: { planKey: string; archived: boolean; at: Date }, tx: PermissionsTransaction) {
    const billing = this.moduleRef.get(PlatformBillingWriteService, { strict: false });
    await billing.planArchiveChanged(input.planKey, input.archived, input.at, billingTransaction(tx));
  }
}
