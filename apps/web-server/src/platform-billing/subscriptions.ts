import type { PermissionsTransaction } from '@kwtech/module-permissions/server';
import { PermissionsWriteService } from '@kwtech/module-permissions/server';
import type {
  BillingPeriodWrite,
  BillingSubscriptionRow,
  PlatformBillingSubscriptions,
  PlatformBillingTransaction,
} from '@kwtech/module-platform-billing/server';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * ⚠ BILLING'S TRANSACTION, HANDED TO PERMISSIONS (#93, the phase-4 spike).
 *
 * Billing's write client is bound with `withTransaction`
 * (`prisma/module-clients.ts`), which gives billing's callback Prisma's
 * interactive transaction client itself. That one object carries every
 * delegate — `permSubscription`, `permPlan`, `permOrganization` included —
 * so it IS a permissions transaction at runtime; only the two modules'
 * structural types, which may not import each other, do not say so.
 *
 * Checked, not assumed: a transaction without permissions' delegates (a test
 * double, or a write client bound some other way) throws here, naming the
 * fix, rather than letting permissions open a transaction of its own and a
 * receipt commit for a plan that never applied.
 */
export function sharedTransaction(tx: PlatformBillingTransaction): Prisma.TransactionClient {
  const candidate = tx as unknown as Partial<Record<'permSubscription' | 'permPlan' | 'permOrganization', unknown>>;
  for (const delegate of ['permSubscription', 'permPlan', 'permOrganization'] as const) {
    const value = candidate[delegate];
    if (typeof value !== 'object' || value === null) {
      throw new Error(
        `Billing's transaction has no ${delegate}, so it cannot be shared with module-permissions. ` +
          "Bind PLATFORM_BILLING_PRISMA_WRITE with withTransaction over the app's PrismaService (prisma/module-clients.ts).",
      );
    }
  }
  // The single cast: the runtime object is Prisma's transaction client, checked above.
  return tx as unknown as Prisma.TransactionClient;
}

/** The shared transaction as permissions' write methods take it. */
function permissionsTransaction(tx: PlatformBillingTransaction): PermissionsTransaction {
  return sharedTransaction(tx);
}

/**
 * Billing's view of `perm_subscription`, and permissions' billed writes,
 * every one inside billing's transaction.
 */
@Injectable()
export class PlatformBillingSubscriptionsAdapter implements PlatformBillingSubscriptions {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsWriteService,
  ) {}

  async live(organizationId: string, tx?: PlatformBillingTransaction): Promise<BillingSubscriptionRow | null> {
    const db = tx ? sharedTransaction(tx) : this.prisma;
    const row = await db.permSubscription.findFirst({
      where: { liveOrganizationId: organizationId },
      select: {
        id: true,
        planKey: true,
        periodStart: true,
        currentPeriodEnd: true,
        billingDay: true,
        accessUntil: true,
        plan: { select: { archivedAt: true } },
      },
    });
    if (!row) return null;
    return {
      subscriptionId: row.id,
      planKey: row.planKey,
      planArchived: row.plan.archivedAt !== null,
      periodStart: row.periodStart,
      currentPeriodEnd: row.currentPeriodEnd,
      billingDay: row.billingDay,
      accessUntil: row.accessUntil,
    };
  }

  renew(input: BillingPeriodWrite, tx: PlatformBillingTransaction) {
    return this.permissions.renewSubscription(input, permissionsTransaction(tx));
  }

  changePlan(input: BillingPeriodWrite & { planKey: string }, tx: PlatformBillingTransaction) {
    return this.permissions.changeSubscriptionPlan(input, permissionsTransaction(tx));
  }

  start(input: BillingPeriodWrite & { planKey: string }, tx: PlatformBillingTransaction) {
    return this.permissions.startBilledSubscription(input, permissionsTransaction(tx));
  }

  setAccessUntil(input: { organizationId: string; accessUntil: Date }, tx: PlatformBillingTransaction) {
    return this.permissions.setSubscriptionAccessUntil(input, permissionsTransaction(tx));
  }
}
