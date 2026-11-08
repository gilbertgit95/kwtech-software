import type {
  PermissionsSubscriptionAudit,
  PermissionsTransaction,
  SubscriptionAdjustment,
} from '@kwtech/module-permissions/server';
import { PlatformBillingWriteService } from '@kwtech/module-platform-billing/server';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { billingTransaction } from './plan-archive.js';

/**
 * ⚠ NOTHING WRITES A SUBSCRIPTION WITHOUT A BILLING RECORD (#114, D5).
 *
 * The admin screens' start, change and end of a subscription each tell
 * billing, inside their own transaction, which records an approved
 * `adjustment` with the admin's reason ("adjusted by X, no payment"). A
 * record that cannot be written rolls the subscription write back.
 *
 * Billing's service is looked up when a write happens, not injected: the
 * same cycle `PlanArchiveToBilling` avoids (billing's subscriptions adapter
 * already injects `PermissionsWriteService`).
 */
@Injectable()
export class SubscriptionAuditToBilling implements PermissionsSubscriptionAudit {
  constructor(private readonly moduleRef: ModuleRef) {}

  /** Billing's per-organization decision lock, taken before the write reads its row. */
  async lock(organizationId: string, tx: PermissionsTransaction): Promise<void> {
    const billing = this.moduleRef.get(PlatformBillingWriteService, { strict: false });
    await billing.lockForAdjustment(organizationId, billingTransaction(tx));
  }

  async subscriptionAdjusted(input: SubscriptionAdjustment, tx: PermissionsTransaction): Promise<void> {
    const billing = this.moduleRef.get(PlatformBillingWriteService, { strict: false });
    await billing.recordAdjustment(input, billingTransaction(tx));
  }
}
