import { archiveCreditNote, planArchiveCredit } from '../src/domain/archives.js';
import { platformDayStart } from '../src/domain/days.js';
import { billingStanding, type SubscriptionDays } from '../src/domain/standing.js';
import { PlatformBillingWriteError } from '../src/server/platform-billing.errors.js';
import { type FakeBilling, fakeBilling, giveSubscription, noonOn, setPrices } from './fake-client.js';

const ORG = 'org1';
const OWNER = 'owner1';
const PRICES = [{ planKey: 'basic', monthly: 100_000, effectiveFrom: '2026-01-01' }];

/** The refusal reason `work` was refused with; fails the test when it was not refused. */
async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof PlatformBillingWriteError) return error.reason;
    throw error;
  }
  throw new Error('Expected a refusal');
}

/** A row on Basic as days, for the pure rule. */
function onBasic(over: Partial<SubscriptionDays> = {}): SubscriptionDays {
  return {
    planKey: 'basic',
    planArchived: false,
    periodStart: '2026-11-01',
    periodEnd: '2026-12-01',
    billingDay: 1,
    accessUntil: '2026-12-08',
    ...over,
  };
}

/** Billing told of an archive (or a restore) as permissions tells it: inside one transaction. */
function archive(billing: FakeBilling, planKey: string, archived: boolean, day: string): Promise<void> {
  return billing.client.$transaction((tx) => billing.writes.planArchiveChanged(planKey, archived, noonOn(day), tx));
}

describe('planArchiveCredit: the paid days an archive takes away (D12b)', () => {
  it('credits the days from the archive day to the period end, the archive day included', () => {
    const credit = planArchiveCredit(billingStanding(onBasic(), '2026-11-13', 7, true), PRICES, 'basic', '2026-11-13');
    // 1,000 × 18/30.
    expect(credit).toEqual({ amount: 60_000, days: 18, prepaidMonth: 0 });
    expect(credit && archiveCreditNote('Basic (2025)', '2026-11-13', credit)).toBe(
      'Basic (2025) was withdrawn on 2026-11-13; 18 paid days added as credit.',
    );
  });

  it('adds a month paid ahead, which the archive also makes unusable', () => {
    const ahead = onBasic({ periodStart: '2026-12-01', periodEnd: '2027-01-01', accessUntil: '2027-01-08' });
    const credit = planArchiveCredit(billingStanding(ahead, '2026-11-25', 7, true), PRICES, 'basic', '2026-11-25');
    // 6 days of November (1,000 × 6/30) and all of December.
    expect(credit).toEqual({ amount: 20_000 + 100_000, days: 6, prepaidMonth: 100_000 });
    expect(credit && archiveCreditNote('Basic', '2026-11-25', credit)).toBe(
      'Basic was withdrawn on 2026-11-25; 6 paid days and a month paid ahead added as credit.',
    );
  });

  it('owes nothing for a trial, an overdue period or an unpriced plan', () => {
    const trial = billingStanding(onBasic({ trial: true }), '2026-11-13', 7, true);
    expect(planArchiveCredit(trial, PRICES, 'basic', '2026-11-13')).toBeNull();
    // Overdue: the grace days were never paid for.
    const overdue = billingStanding(onBasic(), '2026-12-03', 7, true);
    expect(planArchiveCredit(overdue, PRICES, 'basic', '2026-12-03')).toBeNull();
    expect(planArchiveCredit(billingStanding(onBasic(), '2026-11-13', 7, true), [], 'basic', '2026-11-13')).toBeNull();
  });
});

describe('archiving a plan, as billing hears of it', () => {
  async function onBasicFake() {
    const billing = fakeBilling();
    giveSubscription(billing, ORG, 'basic', '2026-11-01', '2026-12-01', '2026-12-08');
    giveSubscription(billing, 'org2', 'pro', '2026-11-01', '2026-12-01', '2026-12-08');
    await setPrices(billing);
    return billing;
  }

  it('credits every organization on the plan once, with the sentence on the ledger', async () => {
    const billing = await onBasicFake();
    await archive(billing, 'basic', true, '2026-11-13');
    expect(billing.store().credits.map((credit) => [credit.organizationId, credit.kind, credit.amount])).toEqual([
      [ORG, 'archive', 60_000],
    ]);
    expect(billing.store().credits[0]?.note).toBe('Basic was withdrawn on 2026-11-13; 18 paid days added as credit.');
    expect(billing.store().credits[0]?.subscriptionId).toBe(billing.store().subscriptions.get(ORG)?.subscriptionId);
    expect(await billing.reads.creditBalance(ORG)).toBe(60_000);
    expect(await billing.reads.creditBalance('org2')).toBe(0);
  });

  it('takes the credit back when the plan is offered again, and credits again on a second archive', async () => {
    const billing = await onBasicFake();
    await archive(billing, 'basic', true, '2026-11-13');
    await archive(billing, 'basic', false, '2026-11-14');
    expect(await billing.reads.creditBalance(ORG)).toBe(0);
    expect(billing.store().credits[1]).toMatchObject({ kind: 'archive_reversal', amount: -60_000 });
    // Archived again on the 21st: the days left from then.
    await archive(billing, 'basic', true, '2026-11-21');
    expect(await billing.reads.creditBalance(ORG)).toBe(33_333);
  });

  it('⚠ credits from what was committed while it waited for the lock, not from its first read', async () => {
    const billing = await onBasicFake();
    const read = billing.subscriptions.liveOnPlan.bind(billing.subscriptions);
    let calls = 0;
    billing.subscriptions.liveOnPlan = async (planKey, tx) => {
      const rows = await read(planKey, tx);
      calls += 1;
      // A renewal of December commits right after the first read, while the archive waits on ORG's lock.
      // (Written through `tx`: the fake's transaction reads its own copy, as a read after the lock sees the commit.)
      if (calls === 1) {
        await billing.subscriptions.renew(
          {
            organizationId: ORG,
            periodStart: platformDayStart('2026-12-01', 'Asia/Manila'),
            periodEnd: platformDayStart('2027-01-01', 'Asia/Manila'),
            billingDay: 1,
            accessUntil: platformDayStart('2027-01-08', 'Asia/Manila'),
          },
          tx,
        );
      }
      return rows;
    };
    await archive(billing, 'basic', true, '2026-11-25');
    // 6 days of November and December, paid ahead: the renewed row, not the stale one.
    expect(billing.store().credits.map((credit) => credit.amount)).toEqual([120_000]);
  });

  it('withdraws pending requests naming the plan that have no payment, cancelling their bills', async () => {
    const billing = await onBasicFake();
    const renewal = await billing.writes.submit(ORG, OWNER, 'renew', null, noonOn('2026-11-26'));
    const away = await billing.writes.submit('org2', OWNER, 'change_plan', 'basic', noonOn('2026-11-26'));
    await archive(billing, 'basic', true, '2026-11-27');

    const states = billing.store().requests.map((request) => [request.id, request.state, request.decisionReason]);
    expect(states).toEqual([
      [renewal.id, 'withdrawn', 'plan_archived'],
      [away.id, 'withdrawn', 'plan_archived'],
    ]);
    expect(billing.store().bills.every((bill) => bill.status === 'cancelled')).toBe(true);
    expect(billing.store().requests.every((request) => request.pendingOrganizationId === null)).toBe(true);
  });

  it('⚠ refuses the archive while a payment waits on an approver, writing nothing', async () => {
    const billing = await onBasicFake();
    const renewal = await billing.writes.submit(ORG, OWNER, 'renew', null, noonOn('2026-11-26'));
    await billing.writes.enterPayment(
      ORG,
      renewal.id,
      OWNER,
      { method: 'cash', amount: 100_000, paidOn: '2026-11-26' },
      noonOn('2026-11-26'),
    );
    expect(await refusal(archive(billing, 'basic', true, '2026-11-27'))).toBe('archive_pending_payments');
    expect(billing.store().requests[0]?.state).toBe('pending');
    expect(billing.store().credits).toEqual([]);
  });
});

describe('a trial reads as unpaid (D2)', () => {
  function onTrial() {
    const billing = fakeBilling();
    giveSubscription(billing, ORG, 'basic', '2026-11-01', '2026-11-15', '2026-11-15', { trial: true });
    return billing;
  }

  it('lets the owner subscribe during the trial, ending the trial row', async () => {
    const billing = onTrial();
    await setPrices(billing);
    const trialRow = billing.store().subscriptions.get(ORG)?.subscriptionId;
    const request = await billing.writes.submit(ORG, OWNER, 'subscribe', 'pro', noonOn('2026-11-05'));
    await billing.writes.enterPayment(
      ORG,
      request.id,
      OWNER,
      { method: 'cash', amount: 150_000, paidOn: '2026-11-05' },
      noonOn('2026-11-05'),
    );
    await billing.writes.approve(
      request.id,
      'approver1',
      { detailsVersion: 1, method: 'cash', amount: 150_000, paidOn: '2026-11-05' },
      noonOn('2026-11-05'),
    );
    const live = billing.store().subscriptions.get(ORG);
    expect(live?.planKey).toBe('pro');
    expect(live?.subscriptionId).not.toBe(trialRow);
  });

  it('has nothing to renew, change, cancel or credit', async () => {
    const billing = onTrial();
    await setPrices(billing);
    expect(await refusal(billing.writes.submit(ORG, OWNER, 'renew', null, noonOn('2026-11-10')))).toBe(
      'no_subscription',
    );
    expect(await refusal(billing.writes.submit(ORG, OWNER, 'change_plan', 'pro', noonOn('2026-11-10')))).toBe(
      'no_subscription',
    );
    expect(await refusal(billing.writes.cancel(ORG, OWNER, noonOn('2026-11-10')))).toBe('no_subscription');
    await archive(billing, 'basic', true, '2026-11-10');
    expect(billing.store().credits).toEqual([]);
  });
});
