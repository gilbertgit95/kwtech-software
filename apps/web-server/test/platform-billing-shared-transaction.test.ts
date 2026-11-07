import type { PlatformBillingTransaction } from '@kwtech/module-platform-billing/server';
import { sharedTransaction } from '../src/platform-billing/subscriptions.js';

/**
 * ⚠ BILLING'S TRANSACTION MUST BE PERMISSIONS' TOO (#93): an approval's
 * subscription and its receipt commit together. The adapter refuses a
 * transaction that could not be shared rather than let permissions write
 * outside it.
 */
describe('sharedTransaction', () => {
  it('hands on a transaction that carries permissions’ delegates, unchanged', () => {
    const tx = { permSubscription: {}, permPlan: {}, permOrganization: {} } as unknown as PlatformBillingTransaction;
    expect(sharedTransaction(tx)).toBe(tx);
  });

  it.each(['permSubscription', 'permPlan', 'permOrganization'])('refuses one without %s, naming the fix', (missing) => {
    const delegates: Record<string, object> = { permSubscription: {}, permPlan: {}, permOrganization: {} };
    delete delegates[missing];
    expect(() => sharedTransaction(delegates as unknown as PlatformBillingTransaction)).toThrow(
      new RegExp(`no ${missing}.*withTransaction`),
    );
  });
});
