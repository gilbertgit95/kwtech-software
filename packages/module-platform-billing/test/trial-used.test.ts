import { refusalText } from '../src/domain/refusals.js';
import { type BillingTrialHistory, checkTrialUsedElsewhere } from '../src/domain/trials.js';
import type { BillingStandingView } from '../src/react/billing-client.js';
import { billingStatus } from '../src/react/view/billing-view.js';
import { renderOverview } from '../src/server/graphql/render.js';
import { fakeBilling, giveSubscription, noonOn, setPrices } from './fake-client.js';

/**
 * #199: a founder's second organization starts on Free with no trial (D2,
 * one trial per founder account), and its Billing page says why instead of
 * reading like any Free organization.
 */

const ORG = 'org2';
const OWNER = 'owner1';
const USED_ELSEWHERE: BillingTrialHistory = { ownTrial: false, founderTrialElsewhere: true };
const ON_FREE = { liveTrial: false, hasPaidSubscription: false, everApproved: false };

describe('checkTrialUsedElsewhere', () => {
  it('names the used trial for a Free organization whose founder had theirs elsewhere', () => {
    expect(checkTrialUsedElsewhere(USED_ELSEWHERE, ON_FREE)).toBe('trial_used');
  });

  it('says nothing when the founder never had a trial, or had it here', () => {
    expect(checkTrialUsedElsewhere({ ownTrial: false, founderTrialElsewhere: false }, ON_FREE)).toBeNull();
    expect(checkTrialUsedElsewhere({ ownTrial: true, founderTrialElsewhere: false }, ON_FREE)).toBeNull();
  });

  it('⚠ says nothing once the organization had a plan: a trial live, a paid row, or any approval', () => {
    expect(checkTrialUsedElsewhere(USED_ELSEWHERE, { ...ON_FREE, liveTrial: true })).toBeNull();
    expect(checkTrialUsedElsewhere(USED_ELSEWHERE, { ...ON_FREE, hasPaidSubscription: true })).toBeNull();
    expect(checkTrialUsedElsewhere(USED_ELSEWHERE, { ...ON_FREE, everApproved: true })).toBeNull();
  });
});

describe('the overview of a founder’s second organization', () => {
  function secondOrganization(history: BillingTrialHistory = USED_ELSEWHERE) {
    const billing = fakeBilling();
    giveSubscription(billing, ORG, 'free', '2026-11-01', '2026-12-01', '2026-12-01');
    billing.store().trialHistory.set(ORG, history);
    return billing;
  }

  it('carries trialUsed, and the page gives the trial_used sentence and its next step', async () => {
    const billing = secondOrganization();
    await setPrices(billing);
    const context = await billing.reads.context(ORG, noonOn('2026-11-10'));
    expect(context.trialUsedElsewhere).toBe(true);

    const standing = renderOverview(context, null).standing as BillingStandingView;
    expect(standing).toMatchObject({ kind: 'none', trial: false, trialUsed: true });
    const status = billingStatus({ standing, creditBalance: 0, currency: 'PHP' });
    const text = refusalText('trial_used');
    expect(status.headline).toBe('No paid plan');
    expect(status.details).toEqual([
      `The organization uses the free plan, with no trial. ${text.message}`,
      text.nextStep,
    ]);
  });

  it('an organization whose founder never used a trial reads as any Free one', async () => {
    const billing = secondOrganization({ ownTrial: false, founderTrialElsewhere: false });
    const context = await billing.reads.context(ORG, noonOn('2026-11-10'));
    expect(context.trialUsedElsewhere).toBe(false);
    expect(
      billingStatus({ standing: renderOverview(context, null).standing, creditBalance: 0, currency: 'PHP' }),
    ).toMatchObject({
      headline: 'No paid plan',
      details: ['The organization uses the free plan. Subscribe to a plan to unlock more.'],
    });
  });

  it('stops saying it once a subscription was approved, even after the plan ended', async () => {
    const billing = secondOrganization();
    await setPrices(billing);
    const request = await billing.writes.submit(ORG, OWNER, 'subscribe', 'basic', noonOn('2026-11-10'));
    await billing.writes.enterPayment(
      ORG,
      request.id,
      OWNER,
      { method: 'cash', amount: 100_000, paidOn: '2026-11-10' },
      noonOn('2026-11-10'),
    );
    await billing.writes.approve(
      request.id,
      'approver1',
      { detailsVersion: 1, method: 'cash', amount: 100_000, paidOn: '2026-11-10' },
      noonOn('2026-11-10'),
    );
    expect((await billing.reads.context(ORG, noonOn('2026-11-11'))).trialUsedElsewhere).toBe(false);

    // Back on Free later (the row ended): it had a plan, so no trial is owed an explanation.
    giveSubscription(billing, ORG, 'free', '2027-01-01', '2027-02-01', '2027-02-01');
    expect((await billing.reads.context(ORG, noonOn('2027-01-05'))).trialUsedElsewhere).toBe(false);
  });

  it('a trial live on the organization is explained as the trial, not as a used one', async () => {
    const billing = secondOrganization({ ownTrial: true, founderTrialElsewhere: false });
    await setPrices(billing);
    giveSubscription(billing, ORG, 'basic', '2026-11-01', '2026-11-15', '2026-11-15', { trial: true });
    const context = await billing.reads.context(ORG, noonOn('2026-11-05'));
    expect(context.trialUsedElsewhere).toBe(false);
    expect(renderOverview(context, null).standing).toMatchObject({ trial: true, trialUsed: false });
  });
});
